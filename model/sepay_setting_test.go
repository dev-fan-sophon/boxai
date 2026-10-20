package model

import (
	"path/filepath"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSePaySettingsPersistAndPreserveAuthoritativeCredential(t *testing.T) {
	oldDB, old := DB, operation_setting.GetSePaySetting()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "settings.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Option{}))
	DB = db
	t.Cleanup(func() {
		DB = oldDB
		operation_setting.SetSePaySetting(old)
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	s := operation_setting.SePaySetting{Enabled: true, BankName: "MB", BankBIN: "970422", BankGateway: "MBBank", AccountNumber: "123456789", AccountName: "BOXAI", MinTopUp: 10000, TransferPrefix: "SEPAY", WebhookSecret: "persisted-test-secret"}
	require.NoError(t, SaveSePaySetting(s, false))
	// A stale process snapshot must not resurrect an old secret on a blank PUT.
	operation_setting.SetSePaySetting(operation_setting.SePaySetting{WebhookSecret: "stale"})
	s.WebhookSecret, s.BankName = "", "Updated"
	require.NoError(t, SaveSePaySetting(s, false))
	assert.Equal(t, "persisted-test-secret", operation_setting.GetSePaySetting().WebhookSecret)
	operation_setting.SetSePaySetting(operation_setting.SePaySetting{})
	loadSePaySetting()
	assert.Equal(t, "Updated", operation_setting.GetSePaySetting().BankName)
	assert.True(t, operation_setting.GetSePaySetting().Enabled)
	assert.Equal(t, "persisted-test-secret", operation_setting.GetSePaySetting().WebhookSecret)
	require.Error(t, SaveSePaySetting(s, true))
	var stored Option
	require.NoError(t, db.Where(&Option{Key: operation_setting.SePayOptionKey}).First(&stored).Error)
	var persisted operation_setting.SePaySetting
	require.NoError(t, common.UnmarshalJsonStr(stored.Value, &persisted))
	assert.True(t, persisted.Enabled)
	assert.Equal(t, "persisted-test-secret", persisted.WebhookSecret)
	// A failed DB write must not publish the requested configuration.
	require.NoError(t, db.Migrator().DropTable(&Option{}))
	s.BankName = "Must not publish"
	require.Error(t, SaveSePaySetting(s, false))
	assert.Equal(t, "Updated", operation_setting.GetSePaySetting().BankName)
}
