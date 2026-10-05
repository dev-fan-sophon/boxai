package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTrialBillingSessionUsesIsolatedLedger(t *testing.T) {
	truncate(t)
	require.NoError(t, model.DB.AutoMigrate(&model.TrialGrant{}, &model.TrialReservation{}, &model.TrialDailyBudget{}))
	oldPolicy, _ := common.Marshal(operation_setting.GetRegistrationRiskPolicy())
	t.Cleanup(func() {
		require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(oldPolicy)))
		model.DB.Exec("DELETE FROM trial_reservations")
		model.DB.Exec("DELETE FROM trial_grants")
		model.DB.Exec("DELETE FROM trial_daily_budgets")
	})
	p := operation_setting.GetRegistrationRiskPolicy()
	p.Enabled = true
	p.TrialEnabled = true
	p.TrialEligibleAfter = 1
	p.TrialModels = []string{"test-text"}
	p.TrialQuota = 100
	p.TrialDailyBudget = 100
	p.TrialMaxRequestQuota = 80
	raw, err := common.Marshal(p)
	require.NoError(t, err)
	require.NoError(t, operation_setting.SetRegistrationRiskPolicy(string(raw)))
	seedUser(t, 7771, 0)
	seedToken(t, 7772, 7771, "trial-session-token", 200)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 7771).Update("email", "trial@example.com").Error)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 7772).Update("expired_time", -1).Error)
	_, err = model.RequestTrial(7771, "trial@example.com", "192.0.2.1")
	require.NoError(t, err)
	_, err = model.ReviewTrial(7771, 99, true, "reviewed")
	require.NoError(t, err)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{UserId: 7771, TokenId: 7772, TokenKey: "trial-session-token", RequestId: "session-1", OriginModelName: "test-text", Request: &dto.GeneralOpenAIRequest{MaxTokens: common.GetPointer(uint(128))}}
	session, apiErr := NewBillingSession(ctx, info, 60)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	assert.Equal(t, "trial", info.BillingSource)
	assert.Equal(t, 60, session.GetPreConsumedQuota())
	assert.False(t, session.trusted)
	require.NoError(t, session.Reserve(70))
	require.Error(t, session.Reserve(81))
	require.NoError(t, session.Settle(23))
	session.Refund(ctx)
	var token model.Token
	require.NoError(t, model.DB.First(&token, 7772).Error)
	assert.Equal(t, 177, token.RemainQuota)
	g, err := model.GetTrialGrant(7771)
	require.NoError(t, err)
	assert.Equal(t, 77, g.Remaining)
	other := map[string]interface{}{}
	appendBillingInfo(info, other)
	assert.Equal(t, 23, other["trial_funded_quota"])
	assert.Equal(t, 0, other["wallet_quota_deducted"])
	info.RequestId = "session-2"
	session, apiErr = NewBillingSession(ctx, info, 40)
	require.Nil(t, apiErr)
	session.Refund(ctx)
	session.Refund(ctx)
	g, err = model.GetTrialGrant(7771)
	require.NoError(t, err)
	assert.Equal(t, 77, g.Remaining)
	info.Request = &dto.GeneralOpenAIRequest{}
	_, apiErr = NewBillingSession(ctx, info, 40)
	require.NotNil(t, apiErr, "unbounded output must not dispatch")
	info.Request = &dto.GeneralOpenAIRequest{MaxTokens: common.GetPointer(uint(p.TrialMaxOutputTokens + 1))}
	_, apiErr = NewBillingSession(ctx, info, 40)
	require.NotNil(t, apiErr)
	info.ForcePreConsume = true
	_, apiErr = NewBillingSession(ctx, info, 40)
	require.NotNil(t, apiErr, "async work must not consume a trial")
	info.ForcePreConsume = false
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 7771).Update("quota", 90).Error)
	info.RequestId = "paid-wallet"
	session, apiErr = NewBillingSession(ctx, info, 30)
	require.Nil(t, apiErr)
	assert.Equal(t, "wallet", info.BillingSource)
	require.NoError(t, session.Settle(30))
	var user model.User
	require.NoError(t, model.DB.First(&user, 7771).Error)
	assert.Equal(t, 60, user.Quota)
	g, err = model.GetTrialGrant(7771)
	require.NoError(t, err)
	assert.Equal(t, 77, g.Remaining, "paid request never changes trial")
	assert.Greater(t, g.ExpiresAt, time.Now().Unix())
}
