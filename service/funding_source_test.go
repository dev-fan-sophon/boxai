package service

import (
	"errors"
	"fmt"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBillingPreConsumeConcurrentWalletFailureRollsBackToken(t *testing.T) {
	truncate(t)
	oldRedisEnabled, oldBatchEnabled := common.RedisEnabled, common.BatchUpdateEnabled
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	t.Cleanup(func() {
		common.RedisEnabled = oldRedisEnabled
		common.BatchUpdateEnabled = oldBatchEnabled
	})

	const userID, tokenID, quota = 7301, 7302, 60
	seedUser(t, userID, 100)
	seedToken(t, tokenID, userID, "concurrent-billing-token", 120)

	results := make(chan *types.NewAPIError, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{
				UserId: userID, TokenId: tokenID, TokenKey: "concurrent-billing-token",
			}
			session := &BillingSession{
				relayInfo: info,
				funding:   &WalletFunding{userId: userID},
			}
			results <- session.preConsume(ctx, quota)
		}()
	}
	wg.Wait()
	close(results)

	successes := 0
	failures := 0
	for apiErr := range results {
		if apiErr == nil {
			successes++
			continue
		}
		failures++
		assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
	}
	assert.Equal(t, 1, successes)
	assert.Equal(t, 1, failures)

	var user model.User
	require.NoError(t, model.DB.First(&user, userID).Error)
	assert.Equal(t, 40, user.Quota)
	var token model.Token
	require.NoError(t, model.DB.First(&token, tokenID).Error)
	assert.Equal(t, 60, token.RemainQuota)
	assert.Equal(t, 60, token.UsedQuota)
}

func TestBillingTrustUsesDatabaseTokenQuota(t *testing.T) {
	truncate(t)
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 10
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })

	const userID, tokenID = 7311, 7312
	trustQuota := common.GetTrustQuota()
	seedUser(t, userID, trustQuota+1)
	seedToken(t, tokenID, userID, "stale-trusted-token", trustQuota-1)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("token_quota", trustQuota+1)
	session := &BillingSession{
		relayInfo: &relaycommon.RelayInfo{
			UserId: userID, TokenId: tokenID, TokenKey: "stale-trusted-token",
			TokenUnlimited: true, UserQuota: trustQuota + 1,
		},
		funding: &WalletFunding{userId: userID},
	}

	assert.False(t, session.shouldTrust(ctx))
}

func TestBillingFundingFailureContracts(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.SubscriptionPlan{}, &model.SubscriptionPreConsumeRecord{}))
	for _, durable := range []bool{false, true} {
		for _, tc := range []struct {
			name                            string
			wallet, token                   int
			subscription, overflow, enabled bool
			limit                           float64
			code                            types.ErrorCode
		}{
			{"wallet empty", 0, 100, false, false, false, 0, types.ErrorCodeInsufficientUserQuota},
			{"wallet short", 1, 100, false, false, false, 0, types.ErrorCodeInsufficientUserQuota},
			{"token short", 100, 1, false, false, false, 0, types.ErrorCodePreConsumeTokenQuotaFailed},
			{"plan cap", 100, 100, true, false, false, 0, types.ErrorCodeInsufficientSubscriptionQuota},
			{"overage disabled", 100, 100, true, true, false, 0, types.ErrorCodeSubscriptionOverageDisabled},
			{"overage limit", 100, 100, true, true, true, 1 / common.QuotaPerUnit, types.ErrorCodeSubscriptionOverageLimitExceeded},
			{"overage wallet empty", 0, 100, true, true, true, 0, types.ErrorCodeInsufficientUserQuota},
			{"subscription token short", 100, 1, true, true, true, 0, types.ErrorCodePreConsumeTokenQuotaFailed},
		} {
			t.Run(fmt.Sprintf("%s/durable=%t", tc.name, durable), func(t *testing.T) {
				truncate(t)
				seedUser(t, 7401, tc.wallet)
				seedToken(t, 7402, 7401, "funding-contract", tc.token)
				if tc.subscription {
					plan := model.SubscriptionPlan{Id: 7403, Title: "contract"}
					require.NoError(t, model.DB.Create(&plan).Error)
					t.Cleanup(func() { model.DB.Delete(&plan) })
					seedSubscription(t, 7404, 7401, 1, 1)
					require.NoError(t, model.DB.Model(&model.UserSubscription{}).Where("id = ?", 7404).Updates(map[string]any{"plan_id": plan.Id, "allow_wallet_overflow": tc.overflow}).Error)
				}
				info := &relaycommon.RelayInfo{UserId: 7401, TokenId: 7402, TokenKey: "funding-contract", RequestId: t.Name(), ForcePreConsume: durable}
				info.UserSetting.OverageEnabled = tc.enabled
				info.UserSetting.OverageLimitUsd = tc.limit
				ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
				session, fault := NewBillingSession(ctx, info, 10)
				require.Nil(t, session)
				require.NotNil(t, fault)
				assert.Equal(t, tc.code, fault.PublicCode())
				assert.Equal(t, 403, fault.StatusCode)
				assert.True(t, types.IsSkipRetryError(fault))
				assert.False(t, types.IsRecordErrorLog(fault))
				assert.Contains(t, fault.PublicMessage(), "BoxAI Web")
				NormalizeRelayServiceFault(fault)
				assert.Nil(t, fault.Diagnostic(), "local funding must not become a channel diagnostic")
				var user model.User
				var token model.Token
				require.NoError(t, model.DB.First(&user, 7401).Error)
				require.NoError(t, model.DB.First(&token, 7402).Error)
				assert.Equal(t, tc.wallet, user.Quota)
				assert.Equal(t, tc.token, token.RemainQuota)
			})
		}
	}
}

func TestBillingDatabaseFailureIsNotUserFunding(t *testing.T) {
	for _, durable := range []bool{false, true} {
		t.Run(fmt.Sprintf("durable=%t", durable), func(t *testing.T) {
			truncate(t)
			seedUser(t, 7411, 100)
			seedToken(t, 7412, 7411, "databasefailure", 100)
			dbErr := errors.New("private database failure")
			require.NoError(t, model.DB.Callback().Update().Before("gorm:update").Register("funding_failure", func(tx *gorm.DB) { tx.AddError(dbErr) }))
			t.Cleanup(func() { require.NoError(t, model.DB.Callback().Update().Remove("funding_failure")) })
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			session, fault := NewBillingSession(ctx, &relaycommon.RelayInfo{UserId: 7411, TokenId: 7412, TokenKey: "databasefailure", RequestId: t.Name(), ForcePreConsume: durable}, 10)
			require.Nil(t, session)
			require.NotNil(t, fault)
			assert.Equal(t, 500, fault.StatusCode)
			assert.Equal(t, types.ErrorCodeUpdateDataError, fault.PublicCode())
			assert.NotContains(t, fault.PublicMessage(), "private")
			assert.NotContains(t, fault.PublicMessage(), "top up")
			assert.ErrorIs(t, fault, dbErr)
			assert.True(t, types.IsRecordErrorLog(fault))
		})
	}
}
