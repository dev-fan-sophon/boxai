package system_setting

import "github.com/dev-fan-sophon/boxai/setting/config"

// ZaloSettings holds the Zalo Social API (OAuth v4) credentials.
// Zalo names them "App ID" and "App Secret Key" in its developer console.
type ZaloSettings struct {
	Enabled   bool   `json:"enabled"`
	AppId     string `json:"app_id"`
	SecretKey string `json:"secret_key"`
}

// 默认配置
var defaultZaloSettings = ZaloSettings{}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("zalo", &defaultZaloSettings)
}

func GetZaloSettings() *ZaloSettings {
	return &defaultZaloSettings
}
