package model

import (
	"sync"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

var sePaySettingsMu sync.Mutex

// One option row makes the credential and destination an indivisible snapshot.
func SaveSePaySetting(s operation_setting.SePaySetting, clearSecret bool) error {
	sePaySettingsMu.Lock()
	defer sePaySettingsMu.Unlock()
	err := DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)}).Transaction(func(tx *gorm.DB) error {
		option := Option{Key: operation_setting.SePayOptionKey, Value: "{}"}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
			return err
		}
		if err := lockForUpdate(tx).Where(&Option{Key: operation_setting.SePayOptionKey}).First(&option).Error; err != nil {
			return err
		}
		var previous operation_setting.SePaySetting
		if err := common.UnmarshalJsonStr(option.Value, &previous); err != nil {
			return err
		}
		if s.WebhookSecret == "" {
			s.WebhookSecret = previous.WebhookSecret
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
		option.Value = string(data)
		return tx.Save(&option).Error
	})
	if err != nil {
		return err
	}
	operation_setting.SetSePaySetting(s)
	return nil
}

func loadSePaySetting() {
	sePaySettingsMu.Lock()
	defer sePaySettingsMu.Unlock()
	var option Option
	if DB.Where(&Option{Key: operation_setting.SePayOptionKey}).First(&option).Error != nil {
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
