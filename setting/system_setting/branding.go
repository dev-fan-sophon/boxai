package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type BrandingSettings struct {
	FaviconURL   string `json:"favicon_url"`
	PrimaryColor string `json:"primary_color"`
	TokenPreset  string `json:"token_preset"`
}

var brandingSettings = BrandingSettings{}

func init() {
	config.GlobalConfig.Register("branding", &brandingSettings)
}

func GetBrandingSettings() *BrandingSettings {
	return &brandingSettings
}
