package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetEnabledGrokPlaygroundSearchAbilitiesEligibility(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}))
	oldDB := DB
	DB = db
	t.Cleanup(func() { DB = oldDB })

	channels := []Channel{
		{Id: 1, Type: constant.ChannelTypeOpenAI, Name: "grok", Status: common.ChannelStatusEnabled},
		{Id: 2, Type: constant.ChannelTypeXai, Name: "native", Status: common.ChannelStatusEnabled},
		{Id: 3, Type: constant.ChannelTypeAnthropic, Name: "other", Status: common.ChannelStatusEnabled},
	}
	require.NoError(t, db.Create(&channels).Error)
	abilities := []Ability{
		{Group: "default", Model: "grok-4.5", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "grok-4.3", ChannelId: 2, Enabled: true},
		{Group: "default", Model: "gpt-4.5", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "grok-4.5", ChannelId: 3, Enabled: true},
	}
	require.NoError(t, db.Create(&abilities).Error)

	got, err := GetEnabledGrokPlaygroundSearchAbilities([]string{"default"})
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.ElementsMatch(t, []int{1, 2}, []int{got[0].ChannelId, got[1].ChannelId})
}
