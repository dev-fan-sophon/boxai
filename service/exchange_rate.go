package service

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
)

const (
	vietcombankExchangeRateURL = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx"
	exchangeRateFetchTimeout   = 12 * time.Second
	// Vietcombank asks for at most one request every 5 minutes.
	minExchangeRateFetchInterval = 5 * time.Minute
	usdVndMinRate                = 10000.0
	usdVndMaxRate                = 50000.0
)

var (
	errExchangeRateUnavailable = errors.New("exchange rate unavailable")
	errExchangeRateOutOfRange  = errors.New("exchange rate out of range")
)

type vietcombankExrateList struct {
	XMLName  xml.Name            `xml:"ExrateList"`
	DateTime string              `xml:"DateTime"`
	Source   string              `xml:"Source"`
	Rates    []vietcombankExrate `xml:"Exrate"`
}

type vietcombankExrate struct {
	CurrencyCode string `xml:"CurrencyCode,attr"`
	Buy          string `xml:"Buy,attr"`
	Transfer     string `xml:"Transfer,attr"`
	Sell         string `xml:"Sell,attr"`
}

type ExchangeRateQuote struct {
	Rate      float64
	Currency  string
	Source    string
	QuotedAt  time.Time
	FetchedAt time.Time
	Buy       float64
	Transfer  float64
	Sell      float64
	Unchanged bool
}

func parseVietcombankAmount(raw string) (float64, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "-" {
		return 0, errExchangeRateUnavailable
	}
	normalized := strings.ReplaceAll(trimmed, ",", "")
	value, err := strconv.ParseFloat(normalized, 64)
	if err != nil || value <= 0 {
		return 0, errExchangeRateUnavailable
	}
	return value, nil
}

func parseVietcombankQuote(body []byte, fetchedAt time.Time) (ExchangeRateQuote, error) {
	var list vietcombankExrateList
	if err := xml.Unmarshal(body, &list); err != nil {
		return ExchangeRateQuote{}, fmt.Errorf("parse vietcombank xml: %w", err)
	}

	var usd *vietcombankExrate
	for i := range list.Rates {
		if list.Rates[i].CurrencyCode == "USD" {
			usd = &list.Rates[i]
			break
		}
	}
	if usd == nil {
		return ExchangeRateQuote{}, fmt.Errorf("%w: USD row missing", errExchangeRateUnavailable)
	}

	sell, err := parseVietcombankAmount(usd.Sell)
	if err != nil {
		return ExchangeRateQuote{}, fmt.Errorf("%w: sell", err)
	}
	if sell < usdVndMinRate || sell > usdVndMaxRate {
		return ExchangeRateQuote{}, fmt.Errorf("%w: sell=%.2f", errExchangeRateOutOfRange, sell)
	}

	quote := ExchangeRateQuote{
		Rate:      sell,
		Currency:  "VND",
		Source:    "Vietcombank",
		FetchedAt: fetchedAt,
		Sell:      sell,
	}
	if buy, buyErr := parseVietcombankAmount(usd.Buy); buyErr == nil {
		quote.Buy = buy
	}
	if transfer, transferErr := parseVietcombankAmount(usd.Transfer); transferErr == nil {
		quote.Transfer = transfer
	}
	if quotedAt, parseErr := time.ParseInLocation("1/2/2006 3:04:05 PM", strings.TrimSpace(list.DateTime), operation_setting.GetBusinessLocation()); parseErr == nil {
		quote.QuotedAt = quotedAt
	}
	if source := strings.TrimSpace(list.Source); source != "" {
		quote.Source = source
	}
	return quote, nil
}

func fetchVietcombankUSDVND(ctx context.Context) (ExchangeRateQuote, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, vietcombankExchangeRateURL, nil)
	if err != nil {
		return ExchangeRateQuote{}, err
	}
	req.Header.Set("User-Agent", "BoxAI/1.0")
	req.Header.Set("Accept", "application/xml,text/xml,*/*")

	resp, err := GetHttpClient().Do(req)
	if err != nil {
		return ExchangeRateQuote{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ExchangeRateQuote{}, fmt.Errorf("vietcombank http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return ExchangeRateQuote{}, err
	}
	return parseVietcombankQuote(body, time.Now())
}

func persistUSDExchangeRate(quote ExchangeRateQuote) error {
	value := strconv.FormatFloat(quote.Rate, 'f', -1, 64)
	if err := model.UpdateOption("USDExchangeRate", value); err != nil {
		return err
	}
	if !quote.QuotedAt.IsZero() {
		if err := model.UpdateOption("USDExchangeRateQuotedAt", strconv.FormatInt(quote.QuotedAt.Unix(), 10)); err != nil {
			return err
		}
	}
	if err := model.UpdateOption("USDExchangeRateFetchedAt", strconv.FormatInt(quote.FetchedAt.Unix(), 10)); err != nil {
		return err
	}
	if err := model.UpdateOption("USDExchangeRateSource", quote.Source); err != nil {
		return err
	}
	return nil
}

func SyncUSDExchangeRate(ctx context.Context) (ExchangeRateQuote, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, exchangeRateFetchTimeout)
	defer cancel()

	quote, err := fetchVietcombankUSDVND(fetchCtx)
	if err != nil {
		return ExchangeRateQuote{}, err
	}

	current := operation_setting.USDExchangeRate
	if current == quote.Rate {
		quote.Unchanged = true
		_ = model.UpdateOption("USDExchangeRateFetchedAt", strconv.FormatInt(quote.FetchedAt.Unix(), 10))
		if !quote.QuotedAt.IsZero() {
			_ = model.UpdateOption("USDExchangeRateQuotedAt", strconv.FormatInt(quote.QuotedAt.Unix(), 10))
		}
		if quote.Source != "" {
			_ = model.UpdateOption("USDExchangeRateSource", quote.Source)
		}
		return quote, nil
	}

	if err := persistUSDExchangeRate(quote); err != nil {
		return ExchangeRateQuote{}, err
	}
	logger.LogInfo(ctx, fmt.Sprintf("synced USD/VND sell rate from Vietcombank: %.2f -> %.2f", current, quote.Rate))
	return quote, nil
}

func ExchangeRateSyncInterval() time.Duration {
	return time.Hour
}

func MinExchangeRateFetchInterval() time.Duration {
	return minExchangeRateFetchInterval
}

func FormatUSDExchangeRate(rate float64) string {
	return strconv.FormatFloat(rate, 'f', -1, 64)
}
