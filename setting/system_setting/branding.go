package system_setting

import "github.com/dev-fan-sophon/boxai/setting/config"

type BrandingSettings struct {
	FaviconURL       string `json:"favicon_url"`
	PrimaryColor     string `json:"primary_color"`
	PrimaryColorDark string `json:"primary_color_dark"` // optional; empty → auto-derive from PrimaryColor
}

var brandingSettings = BrandingSettings{}

func init() {
	config.GlobalConfig.Register("branding", &brandingSettings)
}

func GetBrandingSettings() *BrandingSettings {
	return &brandingSettings
}
