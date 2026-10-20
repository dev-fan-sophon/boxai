package model

import (
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type sePayAccountTransport func(*http.Request) (*http.Response, error)

func (f sePayAccountTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestSePaySettingsPersistAndPreserveAuthoritativeCredential(t *testing.T) {
	transport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = transport })
	http.DefaultTransport = sePayAccountTransport(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer fixture-api-token" {
			return &http.Response{StatusCode: 401, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"status":"success","data":[{"id":"linked-id","bank_short_name":"MBBank","bank_bin":"970422","account_number":"123456789","account_holder_name":"SEPAY HOLDER","active":true}],"meta":{"pagination":{"current_page":1,"last_page":1,"has_more":false}}}`))}, nil
	})
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
	s := operation_setting.SePaySetting{Enabled: true, APIToken: "fixture-api-token", BankAccountID: "linked-id", BankName: "INJECTED", AccountNumber: "99999", WebhookSecret: "persisted-test-secret"}
	require.NoError(t, SaveSePaySetting(s, false))
	assert.Equal(t, "123456789", operation_setting.GetSePaySetting().AccountNumber)
	assert.Equal(t, "SEPAY HOLDER", operation_setting.GetSePaySetting().AccountName)
	// A stale process snapshot must not resurrect an old secret on a blank PUT.
	operation_setting.SetSePaySetting(operation_setting.SePaySetting{WebhookSecret: "stale", APIToken: "stale"})
	s.WebhookSecret, s.APIToken = "", ""
	require.NoError(t, SaveSePaySetting(s, false))
	assert.Equal(t, "persisted-test-secret", operation_setting.GetSePaySetting().WebhookSecret)
	assert.Equal(t, "fixture-api-token", operation_setting.GetSePaySetting().APIToken)
	operation_setting.SetSePaySetting(operation_setting.SePaySetting{})
	loadSePaySetting()
	assert.Equal(t, "MBBank", operation_setting.GetSePaySetting().BankName)
	assert.True(t, operation_setting.GetSePaySetting().Enabled)
	assert.Equal(t, "persisted-test-secret", operation_setting.GetSePaySetting().WebhookSecret)
	require.Error(t, SaveSePaySetting(s, true))
	var stored Option
	require.NoError(t, db.Where(&Option{Key: operation_setting.SePayOptionKey}).First(&stored).Error)
	var persisted operation_setting.SePaySetting
	require.NoError(t, common.UnmarshalJsonStr(stored.Value, &persisted))
	assert.True(t, persisted.Enabled)
	assert.Equal(t, "persisted-test-secret", persisted.WebhookSecret)
	s.BankAccountID = "not-linked"
	require.Error(t, SaveSePaySetting(s, false))
	assert.Equal(t, "linked-id", operation_setting.GetSePaySetting().BankAccountID)
	s.BankAccountID, s.APIToken = "linked-id", "invalid-replacement"
	require.Error(t, SaveSePaySetting(s, false))
	assert.Equal(t, "fixture-api-token", operation_setting.GetSePaySetting().APIToken)
	// Disabling must remain possible during a provider outage.
	http.DefaultTransport = sePayAccountTransport(func(*http.Request) (*http.Response, error) { return nil, errors.New("offline") })
	s.Enabled, s.APIToken = false, ""
	require.NoError(t, SaveSePaySetting(s, false))
	assert.False(t, operation_setting.GetSePaySetting().Enabled)
	assert.Equal(t, "123456789", operation_setting.GetSePaySetting().AccountNumber)
	s.Enabled = true
	require.Error(t, SaveSePaySetting(s, false))
	assert.False(t, operation_setting.GetSePaySetting().Enabled)
	// A failed DB write must not publish the requested configuration.
	require.NoError(t, db.Migrator().DropTable(&Option{}))
	s.BankName = "Must not publish"
	require.Error(t, SaveSePaySetting(s, false))
	assert.Equal(t, "MBBank", operation_setting.GetSePaySetting().BankName)
}
