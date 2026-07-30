package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type FacebookSettings struct {
	Enabled      bool   `json:"enabled"`
	ClientId     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

// 默认配置
var defaultFacebookSettings = FacebookSettings{}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("facebook", &defaultFacebookSettings)
}

func GetFacebookSettings() *FacebookSettings {
	return &defaultFacebookSettings
}
