package service

import (
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
