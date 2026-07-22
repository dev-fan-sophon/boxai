package operation_setting

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/setting/config"
)

// 额度展示类型
const (
	QuotaDisplayTypeUSD     = "USD"
	QuotaDisplayTypeCNY     = "CNY"
	QuotaDisplayTypeVND     = "VND"
	QuotaDisplayTypeTokens  = "TOKENS"
	QuotaDisplayTypeCustom  = "CUSTOM"
	DefaultBusinessTimezone = "Asia/Ho_Chi_Minh"
)

type GeneralSetting struct {
	DocsLink            string `json:"docs_link"`
	PingIntervalEnabled bool   `json:"ping_interval_enabled"`
	PingIntervalSeconds int    `json:"ping_interval_seconds"`
	// 当前站点额度展示类型：USD / CNY / VND / TOKENS / CUSTOM
	QuotaDisplayType string `json:"quota_display_type"`
	// 自定义货币符号，用于 CUSTOM 展示类型
	CustomCurrencySymbol string `json:"custom_currency_symbol"`
	// 自定义货币与美元汇率（1 USD = X Custom）
	CustomCurrencyExchangeRate float64 `json:"custom_currency_exchange_rate"`
	// 业务日期边界使用的 IANA 时区；数据库时间仍统一存储为 UTC/Unix 时间戳。
	BusinessTimezone string `json:"business_timezone"`
}

// 默认配置
var generalSetting = GeneralSetting{
	DocsLink:                   "https://docs.newapi.pro",
	PingIntervalEnabled:        false,
	PingIntervalSeconds:        60,
	QuotaDisplayType:           QuotaDisplayTypeVND,
	CustomCurrencySymbol:       "¤",
	CustomCurrencyExchangeRate: 1.0,
	BusinessTimezone:           DefaultBusinessTimezone,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("general_setting", &generalSetting)
}

func GetGeneralSetting() *GeneralSetting {
	return &generalSetting
}

func ValidateBusinessTimezone(value string) (string, error) {
	timezone := strings.TrimSpace(value)
	if timezone == "" || timezone == "Local" {
		return "", errors.New("business timezone must be an explicit IANA timezone")
	}
	if _, err := time.LoadLocation(timezone); err != nil {
		return "", err
	}
	return timezone, nil
}

func GetBusinessTimezone() string {
	timezone, err := ValidateBusinessTimezone(generalSetting.BusinessTimezone)
	if err != nil {
		return DefaultBusinessTimezone
	}
	return timezone
}

func GetBusinessLocation() *time.Location {
	location, err := time.LoadLocation(GetBusinessTimezone())
	if err != nil {
		return time.FixedZone("ICT", 7*60*60)
	}
	return location
}

// IsCurrencyDisplay 是否以货币形式展示（美元或人民币）
func IsCurrencyDisplay() bool {
	return generalSetting.QuotaDisplayType != QuotaDisplayTypeTokens
}

// IsCNYDisplay 是否以人民币展示
func IsCNYDisplay() bool {
	return generalSetting.QuotaDisplayType == QuotaDisplayTypeCNY
}

// GetQuotaDisplayType 返回额度展示类型
func GetQuotaDisplayType() string {
	return generalSetting.QuotaDisplayType
}

// GetCurrencySymbol 返回当前展示类型对应符号
func GetCurrencySymbol() string {
	switch generalSetting.QuotaDisplayType {
	case QuotaDisplayTypeUSD:
		return "$"
	case QuotaDisplayTypeCNY:
		return "¥"
	case QuotaDisplayTypeVND:
		return "₫"
	case QuotaDisplayTypeCustom:
		if generalSetting.CustomCurrencySymbol != "" {
			return generalSetting.CustomCurrencySymbol
		}
		return "¤"
	default:
		return ""
	}
}

// GetUsdToCurrencyRate 返回 1 USD = X <currency> 的 X（TOKENS 不适用）
func GetUsdToCurrencyRate(usdExchangeRate float64) float64 {
	switch generalSetting.QuotaDisplayType {
	case QuotaDisplayTypeUSD:
		return 1
	case QuotaDisplayTypeCNY, QuotaDisplayTypeVND:
		return usdExchangeRate
	case QuotaDisplayTypeCustom:
		if generalSetting.CustomCurrencyExchangeRate > 0 {
			return generalSetting.CustomCurrencyExchangeRate
		}
		return 1
	default:
		return 1
	}
}
