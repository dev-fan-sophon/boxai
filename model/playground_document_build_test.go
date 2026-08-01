package model

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCreateInternalPlaygroundDocumentBuildAttemptCapsRun(t *testing.T) {
	oldDB := DB
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}, &PlaygroundDocumentBuild{}))
	DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	t.Cleanup(func() { DB = oldDB })

	user := &User{Id: 7, Username: "document-user", Password: "password", Status: common.UserStatusEnabled, Group: "default", AffCode: "doc-user"}
	require.NoError(t, db.Create(user).Error)

	first := &PlaygroundDocumentBuild{UserId: user.Id, ExternalRunId: "run-1", Status: PlaygroundDocumentBuildBuilding}
	claimed, err := CreateInternalPlaygroundDocumentBuildAttempt(first, 1)
	require.NoError(t, err)
	assert.True(t, claimed)
	assert.Equal(t, 1, first.Attempt)

	second := &PlaygroundDocumentBuild{UserId: user.Id, ExternalRunId: "run-1", Status: PlaygroundDocumentBuildBuilding}
	claimed, err = CreateInternalPlaygroundDocumentBuildAttempt(second, 1)
	require.NoError(t, err)
	assert.False(t, claimed)

	var count int64
	require.NoError(t, db.Model(&PlaygroundDocumentBuild{}).Where("external_run_id = ?", "run-1").Count(&count).Error)
	assert.Equal(t, int64(1), count)
}
