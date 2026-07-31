package operation_setting

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"

	"github.com/dev-fan-sophon/boxai/setting/config"
)

type BankQRSetting struct {
	Enabled        bool   `json:"enabled"`
	BankName       string `json:"bank_name"`
	BankBIN        string `json:"bank_bin"`
	AccountNumber  string `json:"account_number"`
	AccountName    string `json:"account_name"`
	MinTopUp       int64  `json:"min_topup"`
	TransferPrefix string `json:"transfer_prefix"`
}

var (
	bankQRSetting  = BankQRSetting{MinTopUp: 1, TransferPrefix: "BOXAI"}
	bankQRSnapshot atomic.Pointer[BankQRSetting]
	bankQRUpdateMu sync.Mutex
)

func init() {
	config.GlobalConfig.Register("bank_qr_setting", &bankQRSetting)
	PublishBankQRSetting()
}

func GetBankQRSetting() BankQRSetting { return *bankQRSnapshot.Load() }

func WithBankQRSettingsUpdate(update func() error) error {
	bankQRUpdateMu.Lock()
	defer bankQRUpdateMu.Unlock()
	return update()
}

func UpdateBankQRConfigField(key, value string) error {
	return config.GlobalConfig.UpdateRegistered("bank_qr_setting", map[string]string{key: value})
}

func PublishBankQRSetting() {
	var snapshot BankQRSetting
	if err := config.GlobalConfig.CopyRegistered("bank_qr_setting", &snapshot); err != nil {
		return
	}
	bankQRSnapshot.Store(&snapshot)
}

func SetBankQRSetting(setting BankQRSetting) {
	_ = config.GlobalConfig.UpdateRegistered("bank_qr_setting", map[string]string{
		"enabled":         strconv.FormatBool(setting.Enabled),
		"bank_name":       setting.BankName,
		"bank_bin":        setting.BankBIN,
		"account_number":  setting.AccountNumber,
		"account_name":    setting.AccountName,
		"min_topup":       strconv.FormatInt(setting.MinTopUp, 10),
		"transfer_prefix": setting.TransferPrefix,
	})
	snapshot := setting
	bankQRSnapshot.Store(&snapshot)
}

func NormalizeBankQRTransferPrefix(value string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(value) {
		if unicode.IsDigit(r) || (r >= 'A' && r <= 'Z') {
			b.WriteRune(r)
		}
		if b.Len() == 10 {
			break
		}
	}
	return b.String()
}

func IsBankQRConfigured() bool {
	return IsBankQRSettingConfigured(GetBankQRSetting())
}

func IsBankQRSettingConfigured(s BankQRSetting) bool {
	return s.Enabled && GetQuotaDisplayType() == QuotaDisplayTypeVND && USDExchangeRate > 0 && ValidateBankQRSetting(s) == nil
}

func ValidateBankQRSetting(s BankQRSetting) error {
	if s.MinTopUp <= 0 {
		return fmt.Errorf("minimum top-up must be positive")
	}
	if NormalizeBankQRTransferPrefix(s.TransferPrefix) == "" {
		return fmt.Errorf("transfer prefix is required")
	}
	if !s.Enabled {
		return nil
	}
	if strings.TrimSpace(s.BankName) == "" {
		return fmt.Errorf("bank name is required")
	}
	if len(s.BankBIN) != 6 || !onlyDigits(s.BankBIN) {
		return fmt.Errorf("bank BIN must contain 6 digits")
	}
	if len(s.AccountNumber) == 0 || len(s.AccountNumber) > 19 || !onlyDigits(s.AccountNumber) {
		return fmt.Errorf("account number must contain 1 to 19 digits")
	}
	if strings.TrimSpace(s.AccountName) == "" {
		return fmt.Errorf("account holder name is required")
	}
	return nil
}

func onlyDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
