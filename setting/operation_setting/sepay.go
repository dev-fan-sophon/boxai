package operation_setting

import (
	"errors"
	"strings"
	"sync/atomic"
)

const SePayOptionKey = "sepay_setting"

type SePaySetting struct {
	Enabled        bool   `json:"enabled"`
	BankName       string `json:"bank_name"`
	BankBIN        string `json:"bank_bin"`
	BankGateway    string `json:"bank_gateway"`
	AccountNumber  string `json:"account_number"`
	AccountName    string `json:"account_name"`
	SubAccount     string `json:"sub_account"`
	MinTopUp       int64  `json:"min_topup"`
	TransferPrefix string `json:"transfer_prefix"`
	WebhookSecret  string `json:"webhook_secret"`
}

var sePaySnapshot atomic.Pointer[SePaySetting]

func init()                          { SetSePaySetting(SePaySetting{MinTopUp: 10000, TransferPrefix: "SEPAY"}) }
func GetSePaySetting() SePaySetting  { return *sePaySnapshot.Load() }
func SetSePaySetting(s SePaySetting) { sePaySnapshot.Store(&s) }

func NormalizeSePaySetting(s *SePaySetting) {
	s.BankName = strings.TrimSpace(s.BankName)
	s.BankBIN = strings.TrimSpace(s.BankBIN)
	s.BankGateway = strings.TrimSpace(s.BankGateway)
	s.AccountNumber = strings.TrimSpace(s.AccountNumber)
	s.AccountName = strings.TrimSpace(s.AccountName)
	s.SubAccount = strings.TrimSpace(s.SubAccount)
	var prefix strings.Builder
	for _, r := range strings.ToUpper(s.TransferPrefix) {
		if r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			prefix.WriteRune(r)
		}
		if prefix.Len() == 10 {
			break
		}
	}
	s.TransferPrefix = prefix.String()
}

func ValidateSePaySetting(s SePaySetting) error {
	if s.MinTopUp < 10000 || s.MinTopUp >= 500000000 || s.TransferPrefix == "" || len(s.TransferPrefix) > 10 || len(s.WebhookSecret) > 4096 {
		return errors.New("invalid SePay settings")
	}
	if s.Enabled && (s.BankName == "" || len(s.BankName) > 128 || len(s.BankBIN) != 6 || !onlyDigits(s.BankBIN) || s.AccountNumber == "" || len(s.AccountNumber) > 19 || !onlyDigits(s.AccountNumber) || s.AccountName == "" || len(s.AccountName) > 128 || s.BankGateway == "" || len(s.BankGateway) > 128 || len(s.SubAccount) > 128 || strings.TrimSpace(s.WebhookSecret) == "") {
		return errors.New("invalid SePay settings")
	}
	return nil
}
