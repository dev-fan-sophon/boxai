package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseVietcombankQuoteUsesSellRate(t *testing.T) {
	body := []byte(`
<ExrateList>
  <DateTime>8/14/2026 1:43:48 PM</DateTime>
  <Exrate CurrencyCode="EUR" CurrencyName="EURO" Buy="29310.67" Transfer="29606.74" Sell="30856.33" />
  <Exrate CurrencyCode="USD" CurrencyName="US DOLLAR" Buy="25,860.00" Transfer="25,890.00" Sell="26,270.00" />
  <Source>Joint Stock Commercial Bank for Foreign Trade of Vietnam - Vietcombank</Source>
</ExrateList>`)

	quote, err := parseVietcombankQuote(body, time.Date(2026, 8, 14, 6, 43, 48, 0, time.UTC))
	require.NoError(t, err)
	assert.Equal(t, 26270.0, quote.Rate)
	assert.Equal(t, 25860.0, quote.Buy)
	assert.Equal(t, 25890.0, quote.Transfer)
	assert.Equal(t, 26270.0, quote.Sell)
	assert.Equal(t, "VND", quote.Currency)
	assert.Contains(t, quote.Source, "Vietcombank")
	assert.False(t, quote.QuotedAt.IsZero())
}

func TestParseVietcombankQuoteRejectsMissingUSD(t *testing.T) {
	body := []byte(`<ExrateList><Exrate CurrencyCode="EUR" Sell="30000" /></ExrateList>`)
	_, err := parseVietcombankQuote(body, time.Now())
	require.Error(t, err)
}

func TestParseVietcombankQuoteRejectsOutOfRangeSell(t *testing.T) {
	body := []byte(`<ExrateList><Exrate CurrencyCode="USD" Sell="120" /></ExrateList>`)
	_, err := parseVietcombankQuote(body, time.Now())
	require.ErrorIs(t, err, errExchangeRateOutOfRange)
}
