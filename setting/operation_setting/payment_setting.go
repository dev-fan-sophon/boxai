package operation_setting

import "github.com/dev-fan-sophon/boxai/setting/config"

type PaymentSetting struct {
	// Top-up discounts live in the tiered TopUpPromotion and coupons, which
	// are applied when the order is priced; this list only seeds the presets.
	AmountOptions []int `json:"amount_options"`

	ComplianceConfirmed    bool   `json:"compliance_confirmed"`
	ComplianceTermsVersion string `json:"compliance_terms_version"`
	ComplianceConfirmedAt  int64  `json:"compliance_confirmed_at"`
	ComplianceConfirmedBy  int    `json:"compliance_confirmed_by"`
	ComplianceConfirmedIP  string `json:"compliance_confirmed_ip"`
}

const CurrentComplianceTermsVersion = "v1"

// 默认配置
var paymentSetting = PaymentSetting{
	AmountOptions: []int{10, 20, 50, 100, 200, 500},
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("payment_setting", &paymentSetting)
}

func GetPaymentSetting() *PaymentSetting {
	return &paymentSetting
}

func IsPaymentComplianceConfirmed() bool {
	return true
}
