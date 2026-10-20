// Package sepay reads linked receiving accounts from the official SePay API v2.
package sepay

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/pkg/vietqr"
)

type BankAccount struct {
	ID            string          `json:"id"`
	BankShortName string          `json:"bank_short_name"`
	BankFullName  string          `json:"bank_full_name"`
	BankBIN       string          `json:"bank_bin"`
	AccountNumber string          `json:"account_number"`
	AccountHolder string          `json:"account_holder_name"`
	Active        json.RawMessage `json:"active"`
}

// SupportsCheckout excludes inactive/incomplete accounts and destinations our
// VietQR encoder cannot represent. Never guess a missing BIN from a bank name.
func (a BankAccount) SupportsCheckout() bool {
	active := string(a.Active)
	if (active != "true" && active != "1") || a.ID == "" || a.BankShortName == "" || len(a.BankShortName) > 128 || strings.TrimSpace(a.AccountHolder) == "" || len(a.AccountHolder) > 128 {
		return false
	}
	// SePay locks parent-account webhooks for these banks: they require VA.
	// https://developer.sepay.vn/vi/sepay-webhooks/tai-khoan-ngan-hang
	// Match BINs from SePay's linked https://vietqr.app/banks.json catalog,
	// not display-name casing or aliases. This integration does not support VA.
	switch a.BankBIN {
	case "970418", "970426", "970452", "970448": // BIDV, MSB, KienLongBank, OCB
		return false
	}
	_, err := vietqr.Payload(a.BankBIN, a.AccountNumber, 10000, "SEPAYTEST")
	return err == nil
}

// ListBankAccounts deliberately lists bank accounts, not virtual accounts.
// Official VA destinations and memo-based TKP identifiers have different
// webhook/QR semantics and must not be substituted for account_number.
func ListBankAccounts(ctx context.Context, token string) ([]BankAccount, error) {
	if strings.TrimSpace(token) == "" || len(token) > 4096 || strings.ContainsAny(token, "\r\n") {
		return nil, errors.New("SePay API token is required")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	accounts := []BankAccount{}
	for page := 1; page <= 100; page++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://userapi.sepay.vn/v2/bank-accounts?page=%d&per_page=100", page), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/json")
		res, err := client.Do(req)
		if err != nil {
			return nil, errors.New("unable to reach SePay API")
		}
		body, readErr := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024+1))
		res.Body.Close()
		if res.StatusCode != http.StatusOK || readErr != nil || len(body) > 2*1024*1024 {
			return nil, errors.New("unable to read SePay accounts; check API token and permissions")
		}
		var result struct {
			Status string        `json:"status"`
			Data   []BankAccount `json:"data"`
			Meta   struct {
				Pagination struct {
					CurrentPage int  `json:"current_page"`
					LastPage    int  `json:"last_page"`
					HasMore     bool `json:"has_more"`
				} `json:"pagination"`
			} `json:"meta"`
		}
		if common.Unmarshal(body, &result) != nil || result.Status != "success" || result.Data == nil || result.Meta.Pagination.CurrentPage != page || result.Meta.Pagination.LastPage < page {
			return nil, errors.New("invalid SePay accounts response")
		}
		accounts = append(accounts, result.Data...)
		if !result.Meta.Pagination.HasMore && page >= result.Meta.Pagination.LastPage {
			return accounts, nil
		}
	}
	return nil, errors.New("too many SePay account pages")
}
