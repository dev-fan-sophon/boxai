package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func resetSystemNotices(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&SystemNotice{}, &Option{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&SystemNotice{}).Error)
	require.NoError(t, DB.Where(commonKeyCol+" = ?", "Notice").Delete(&Option{}).Error)
}

func TestPublishingNoticeKeepsEarlierNotices(t *testing.T) {
	resetSystemNotices(t)
	t.Cleanup(func() { resetSystemNotices(t) })
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = map[string]string{}
	}
	common.OptionMapRWMutex.Unlock()

	first, err := CreateSystemNotice("  maintenance tonight  ")
	require.NoError(t, err)
	second, err := CreateSystemNotice("new models available")
	require.NoError(t, err)

	notices, err := ListSystemNotices(SystemNoticeListLimit)
	require.NoError(t, err)
	require.Len(t, notices, 2)
	assert.Equal(t, second.Id, notices[0].Id)
	assert.Equal(t, "maintenance tonight", notices[1].Content)
	assert.Equal(t, "new models available", common.OptionMap["Notice"])

	require.NoError(t, DeleteSystemNotice(second.Id))
	assert.Equal(t, "maintenance tonight", common.OptionMap["Notice"])

	require.NoError(t, DeleteSystemNotice(first.Id))
	assert.Equal(t, "", common.OptionMap["Notice"])
	assert.Error(t, DeleteSystemNotice(first.Id))

	_, err = CreateSystemNotice("   ")
	assert.Error(t, err)
}

func TestSeedSystemNoticesFromLegacyOption(t *testing.T) {
	resetSystemNotices(t)
	t.Cleanup(func() { resetSystemNotices(t) })
	require.NoError(t, DB.Create(&Option{Key: "Notice", Value: "legacy notice"}).Error)

	require.NoError(t, seedSystemNoticesFromOption())
	require.NoError(t, seedSystemNoticesFromOption())

	notices, err := ListSystemNotices(SystemNoticeListLimit)
	require.NoError(t, err)
	require.Len(t, notices, 1)
	assert.Equal(t, "legacy notice", notices[0].Content)
}
