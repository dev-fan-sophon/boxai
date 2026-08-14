package model

import (
	"errors"
	"math"

	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/shopspring/decimal"
)

const (
	TopUpFaceCurrencyVND = "VND"

	MinTopUpFaceVND = 10_000
	MaxTopUpFaceVND = 500_000_000
	MaxTopUpUSDCent = 10_000_000
)

var (
	ErrTopUpQuoteInvalidAmount = errors.New("invalid top-up amount")
	ErrTopUpQuoteInvalidRate   = errors.New("exchange rate is invalid")
	ErrTopUpQuoteOutOfRange    = errors.New("top-up amount out of range")
	ErrTopUpQuoteNotCreditable = errors.New("top-up amount cannot be credited")
)

type TopUpQuote struct {
	FaceAmountMinor int64
	FaceCurrency    string
	CreditCents     int64
	FXRate          decimal.Decimal
	FXRateText      string
	FXSource        string
	FXQuotedAt      int64
}

func currentCreditFXRate() (decimal.Decimal, error) {
	rate := operation_setting.USDExchangeRate
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return decimal.Zero, ErrTopUpQuoteInvalidRate
	}
	return decimal.NewFromFloat(rate), nil
}

func QuoteVNDTopUp(faceVND int64) (TopUpQuote, error) {
	if faceVND < MinTopUpFaceVND || faceVND >= MaxTopUpFaceVND {
		return TopUpQuote{}, ErrTopUpQuoteOutOfRange
	}

	rate, err := currentCreditFXRate()
	if err != nil {
		return TopUpQuote{}, err
	}

	cents, err := USDToCents(decimal.NewFromInt(faceVND).Div(rate).Round(2))
	if err != nil || cents < 1 || cents > MaxTopUpUSDCent {
		return TopUpQuote{}, ErrTopUpQuoteOutOfRange
	}

	quote := TopUpQuote{
		FaceAmountMinor: faceVND,
		FaceCurrency:    TopUpFaceCurrencyVND,
		CreditCents:     cents,
		FXRate:          rate,
		FXRateText:      rate.String(),
		FXSource:        operation_setting.USDExchangeRateSource,
		FXQuotedAt:      operation_setting.USDExchangeRateQuotedAt,
	}
	if _, creditErr := TopUpQuota(&TopUp{
		Amount:     quote.CreditCents,
		AmountUnit: TopUpAmountUnitUSDCent,
	}); creditErr != nil {
		return TopUpQuote{}, errors.Join(ErrTopUpQuoteNotCreditable, creditErr)
	}
	return quote, nil
}

func (quote TopUpQuote) Apply(order *TopUp) {
	if order == nil {
		return
	}
	order.Amount = quote.CreditCents
	order.AmountUnit = TopUpAmountUnitUSDCent
	order.Money = float64(quote.FaceAmountMinor)
	order.FaceAmountMinor = quote.FaceAmountMinor
	order.FaceCurrency = quote.FaceCurrency
	order.CreditFXRate = quote.FXRateText
	order.CreditFXSource = quote.FXSource
	order.CreditFXQuotedAt = quote.FXQuotedAt
}

func ParseWholeVND(amount decimal.Decimal) (int64, error) {
	if !amount.IsPositive() || !amount.Equal(amount.Truncate(0)) {
		return 0, ErrTopUpQuoteInvalidAmount
	}
	if amount.GreaterThan(decimal.NewFromInt(math.MaxInt64)) {
		return 0, ErrTopUpQuoteOutOfRange
	}
	return amount.IntPart(), nil
}
