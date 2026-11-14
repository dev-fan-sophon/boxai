package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCreateUserRejectsNonStandardRole(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() {
		model.DB = oldDB
		sqlDB, _ := db.DB()
		_ = sqlDB.Close()
	})
	gin.SetMode(gin.TestMode)

	for i, tc := range []struct {
		name               string
		role, operatorRole int
	}{
		{"between common and admin", 5, common.RoleAdminUser},
		{"negative", -1, common.RoleAdminUser},
		{"between admin and root", 99, common.RoleRootUser},
	} {
		t.Run(tc.name, func(t *testing.T) {
			username := fmt.Sprintf("odd-role-%d", i)
			body := fmt.Sprintf(`{"username":%q,"password":"member-password-1","role":%d}`, username, tc.role)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/user/", strings.NewReader(body))
			c.Set("role", tc.operatorRole)
			CreateUser(c)

			var result struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
			assert.False(t, result.Success, recorder.Body.String())
			var count int64
			require.NoError(t, db.Model(&model.User{}).Where("username = ?", username).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}
