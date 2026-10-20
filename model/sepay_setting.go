package model

import (
	"sync"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var sePaySettingsMu sync.Mutex

// One option row makes the credential and destination an indivisible snapshot.
func SaveSePaySetting(s operation_setting.SePaySetting, clearSecret bool) error {
	sePaySettingsMu.Lock()
	defer sePaySettingsMu.Unlock()
	if s.WebhookSecret == "" {
		s.WebhookSecret = operation_setting.GetSePaySetting().WebhookSecret
	}
	if clearSecret {
		s.WebhookSecret = ""
	}
	operation_setting.NormalizeSePaySetting(&s)
	if err := operation_setting.ValidateSePaySetting(s); err != nil {
		return err
	}
	data, err := common.Marshal(s)
	if err != nil {
		return err
	}
	if err = DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).Save(&Option{Key: operation_setting.SePayOptionKey, Value: string(data)}).Error; err != nil {
		return err
	}
	operation_setting.SetSePaySetting(s)
	return nil
}

func loadSePaySetting() {
	sePaySettingsMu.Lock()
	defer sePaySettingsMu.Unlock()
	var option Option
	if DB.Where("key = ?", operation_setting.SePayOptionKey).First(&option).Error != nil {
		return
	}
	var s operation_setting.SePaySetting
	if common.UnmarshalJsonStr(option.Value, &s) != nil {
		return
	}
	operation_setting.NormalizeSePaySetting(&s)
	if operation_setting.ValidateSePaySetting(s) == nil {
		operation_setting.SetSePaySetting(s)
	}
}
