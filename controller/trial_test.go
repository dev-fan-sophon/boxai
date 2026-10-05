package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTrialClaimRequiresOwnSingleUsePurposeBoundCode(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TrialGrant{}))
	oldDB, oldRedis := model.DB, common.RedisEnabled
	oldPolicy, _ := common.Marshal(operation_setting.GetRegistrationRiskPolicy())
	model.DB, common.RedisEnabled = db, false
	t.Cleanup(func() {
		model.DB, common.RedisEnabled = oldDB, oldRedis
		require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(oldPolicy)))
		_ = sqlDB.Close()
	})
	p := operation_setting.GetRegistrationRiskPolicy()
	p.Enabled, p.TrialEnabled, p.TrialEligibleAfter = true, true, 1
	p.TrialModels = []string{"test-model"}
	raw, err := common.Marshal(p)
	require.NoError(t, err)
	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(raw)))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "trial", AffCode: "trial", Email: "test@example.com", Status: common.UserStatusEnabled}).Error)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("id", 1) })
	router.POST("/trial", RequestSelfTrial)
	router.GET("/trial", GetSelfTrial)
	require.NoError(t, common.RegisterVerificationCodeWithKey("test@example.com", "abcdef", common.EmailVerificationPurpose))
	require.NoError(t, common.RegisterVerificationCodeWithKey("2:test@example.com", "abcdef", trialVerificationPurpose))
	for _, want := range []bool{false, true, false} {
		if want {
			require.NoError(t, common.RegisterVerificationCodeWithKey("1:test@example.com", "abcdef", trialVerificationPurpose))
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/trial", strings.NewReader(`{"code":"ABCDEF"}`)))
		var response struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		assert.Equal(t, want, response.Success)
	}
	require.NoError(t, db.Model(&model.TrialGrant{}).Where("user_id = ?", 1).Updates(map[string]any{"review_reason": "private investigation", "reviewer_id": 99}).Error)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/trial", nil))
	assert.Contains(t, w.Body.String(), `"pending"`)
	assert.NotContains(t, w.Body.String(), "private investigation")
	assert.NotContains(t, w.Body.String(), "identity_hash")
	assert.NotContains(t, w.Body.String(), "reviewer_id")
}
