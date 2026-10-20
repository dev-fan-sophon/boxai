package sepay

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type accountTransport func(*http.Request) (*http.Response, error)

func (f accountTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestListBankAccountsOfficialPaginationAndEligibility(t *testing.T) {
	old := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = old })
	http.DefaultTransport = accountTransport(func(r *http.Request) (*http.Response, error) {
		require.Equal(t, "https", r.URL.Scheme)
		require.Equal(t, "userapi.sepay.vn", r.URL.Host)
		require.Equal(t, "/v2/bank-accounts", r.URL.Path)
		require.Equal(t, "Bearer fixture-api-token", r.Header.Get("Authorization"))
		page := r.URL.Query().Get("page")
		active := "true"
		if page == "2" {
			active = "1"
		}
		body := fmt.Sprintf(`{"status":"success","data":[{"id":"account-%s","bank_short_name":"ACB","bank_full_name":"Asia Commercial Bank","bank_bin":"970416","account_number":"0123456789","account_holder_name":"NGUYEN VAN A","active":%s}],"meta":{"pagination":{"current_page":%s,"last_page":2,"has_more":%t}}}`, page, active, page, page == "1")
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	accounts, err := ListBankAccounts(context.Background(), "fixture-api-token")
	require.NoError(t, err)
	require.Len(t, accounts, 2)
	assert.Equal(t, "account-2", accounts[1].ID)
	assert.Equal(t, "0123456789", accounts[0].AccountNumber)
	assert.True(t, accounts[0].SupportsCheckout())
	assert.True(t, accounts[1].SupportsCheckout())
	for _, tc := range []struct {
		name   string
		change func(*BankAccount)
	}{
		{"inactive bool", func(a *BankAccount) { a.Active = []byte("false") }},
		{"inactive number", func(a *BankAccount) { a.Active = []byte("0") }},
		{"missing BIN", func(a *BankAccount) { a.BankBIN = "" }},
		{"VA identifier", func(a *BankAccount) { a.AccountNumber = "VA001234" }},
		{"missing holder", func(a *BankAccount) { a.AccountHolder = "" }},
	} {
		t.Run(tc.name, func(t *testing.T) { a := accounts[0]; tc.change(&a); assert.False(t, a.SupportsCheckout()) })
	}
	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		{"unauthorized", 401, `{"message":"fixture-api-token"}`},
		{"provider error", 200, `{"status":"error","message":"fixture-api-token"}`},
		{"invalid JSON", 200, `invalid`},
		{"missing pagination", 200, `{"status":"success","data":[]}`},
		{"repeated page", 200, `{"status":"success","data":[],"meta":{"pagination":{"current_page":1,"last_page":2,"has_more":true}}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			http.DefaultTransport = accountTransport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			data, err := ListBankAccounts(context.Background(), "fixture-api-token")
			require.Error(t, err)
			assert.Nil(t, data)
			assert.NotContains(t, err.Error(), "fixture-api-token")
		})
	}
}
