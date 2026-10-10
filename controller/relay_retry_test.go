package controller

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/middleware"
	"github.com/dev-fan-sophon/boxai/model"
	relaychannel "github.com/dev-fan-sophon/boxai/relay/channel"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRelayRetryUsesOriginalFailure(t *testing.T) {
	previous := operation_setting.AutomaticRetryStatusCodeRanges
	operation_setting.AutomaticRetryStatusCodeRanges = []operation_setting.StatusCodeRange{{Start: 400, End: 599}}
	t.Cleanup(func() { operation_setting.AutomaticRetryStatusCodeRanges = previous })
	for _, tc := range []struct {
		status int
		retry  bool
	}{
		{400, false}, {413, false}, {422, false}, {429, true},
		{401, true}, {502, true}, {504, false}, {524, false},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
		fault := types.NewOpenAIError(errors.New("private upstream detail"), types.ErrorCodeBadResponseStatusCode, tc.status)
		service.NormalizeRelayServiceFault(fault)
		assert.Equal(t, tc.retry, shouldRetry(c, fault, 3), "original HTTP %d", tc.status)
		assert.False(t, shouldRetry(c, fault, 0), "budget exhausted")
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx, cancel := context.WithCancel(context.Background())
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil).WithContext(ctx)
	fault := types.NewError(errors.New("channel unavailable"), types.ErrorCodeChannelNoAvailableKey)
	assert.False(t, shouldRetry(c, fault, 0), "channel errors must obey budget too")
	cancel()
	assert.False(t, shouldRetry(c, fault, 3), "disconnect must not start new work")
	c.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	c.Writer.WriteHeaderNow()
	assert.False(t, shouldRetry(c, fault, 3), "committed stream cannot be replayed")
}

func TestRelayHTTPFailureDoesNotReplayExhaustedChannels(t *testing.T) {
	oldDB, oldCache, oldRetries := model.DB, common.MemoryCacheEnabled, common.RetryTimes
	oldCount, oldLogs := constant.CountToken, constant.ErrorLogEnabled
	oldRatios := ratio_setting.ModelRatio2JSONString()
	oldFreePreconsume := operation_setting.GetQuotaSetting().EnableFreeModelPreConsume
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	model.DB, common.MemoryCacheEnabled, common.RetryTimes = db, true, 3
	constant.CountToken, constant.ErrorLogEnabled = false, false
	operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = false
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"retry-fixture":0}`))
	t.Cleanup(func() {
		model.DB, common.MemoryCacheEnabled, common.RetryTimes = oldDB, oldCache, oldRetries
		constant.CountToken, constant.ErrorLogEnabled = oldCount, oldLogs
		operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = oldFreePreconsume
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatios))
		if oldDB != nil && oldDB.Migrator().HasTable(&model.Ability{}) {
			model.InitChannelCache()
		}
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	service.InitHttpClient()
	for _, tc := range []struct{ status, calls int }{{400, 1}, {503, 2}, {429, 2}} {
		var calls atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			w.Header().Set("X-CPA-Trace-Id", "cpa-http-fixture")
			w.Header().Set("Retry-After", "45")
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(`{"error":{"message":"private provider failure","type":"upstream_error"}}`))
		}))
		require.NoError(t, db.Exec("DELETE FROM abilities").Error)
		require.NoError(t, db.Exec("DELETE FROM channels").Error)
		var first model.Channel
		for _, id := range []int{71, 72} {
			channel := model.Channel{Id: id, Name: "fixture", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Key: "fixture", BaseURL: common.GetPointer(server.URL), Group: "default", Models: "retry-fixture", AutoBan: common.GetPointer(0)}
			require.NoError(t, db.Create(&channel).Error)
			require.NoError(t, db.Create(&model.Ability{ChannelId: id, Group: "default", Model: "retry-fixture", Enabled: true, Priority: common.GetPointer(int64(0))}).Error)
			if id == 71 {
				first = channel
			}
		}
		model.InitChannelCache()
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"retry-fixture","messages":[{"role":"user","content":"hello"}]}`))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set(common.RequestIdKey, "relay-http-fixture")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
		require.Nil(t, middleware.SetupContextForSelectedChannel(c, &first, "retry-fixture"))
		Relay(c, types.RelayFormatOpenAI)
		common.CleanupBodyStorage(c)
		server.Close()
		assert.Equal(t, int32(tc.calls), calls.Load(), "HTTP %d: %s", tc.status, w.Body.String())
		assert.NotContains(t, w.Body.String(), "private provider")
		if tc.status == 400 {
			assert.Empty(t, w.Header().Get("Retry-After"), "invalid requests must not encourage client retries")
		} else {
			assert.Equal(t, "45", w.Header().Get("Retry-After"))
		}
		if tc.status == 503 {
			assert.Equal(t, 502, w.Code)
		} else {
			assert.Equal(t, tc.status, w.Code)
		}
	}
}

func TestTaskSubmissionOnlyRetriesExplicitRateLimitRejection(t *testing.T) {
	for _, status := range []int{307, 400, 401, 408, 413, 429, 500, 502, 503, 504} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest("POST", "/v1/videos", nil)
		fault := &dto.TaskError{StatusCode: status, Message: "private upstream detail"}
		assert.Equal(t, status == 429, shouldRetryTaskRelay(c, 7, fault, 3), "HTTP %d", status)
		fault.LocalError = true
		assert.False(t, shouldRetryTaskRelay(c, 7, fault, 3))
	}
}

func TestTaskErrorResponseIsSanitizedAndPreservesRetryAfter(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(relaychannel.UpstreamRetryAfterKey, 60)
	fault := &dto.TaskError{StatusCode: 429, Code: "private_code", Message: "private credential details", Data: "private account data"}
	respondTaskError(c, fault)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.Equal(t, "60", w.Header().Get("Retry-After"))
	assert.NotContains(t, w.Body.String(), "private")
	assert.Contains(t, w.Body.String(), "model_temporarily_busy")
	assert.Equal(t, "private credential details", fault.Message, "diagnostic source must not be mutated")
}

func TestTaskFundingErrorsRemainLocalAndActionable(t *testing.T) {
	for _, code := range []types.ErrorCode{
		types.ErrorCodeInsufficientUserQuota, types.ErrorCodeInsufficientSubscriptionQuota,
		types.ErrorCodeSubscriptionOverageDisabled, types.ErrorCodeSubscriptionOverageLimitExceeded,
		types.ErrorCodePreConsumeTokenQuotaFailed,
	} {
		t.Run(string(code), func(t *testing.T) {
			apiErr := types.NewFundingError(errors.New("private billing details"), code)
			fault := service.TaskErrorFromAPIError(apiErr)
			require.NotNil(t, fault)
			assert.True(t, fault.LocalError)
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest("POST", "/v1/videos", nil)
			assert.False(t, shouldRetryTaskRelay(c, 7, fault, 3))
			assert.False(t, shouldRetry(c, apiErr, 3))
			respondTaskError(c, fault)
			assert.Equal(t, 403, w.Code)
			var body dto.TaskError
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &body))
			assert.Equal(t, string(code), body.Code)
			assert.Equal(t, apiErr.ToOpenAIError().Message, body.Message)
			assert.Contains(t, body.Message, "BoxAI Web")
			assert.NotContains(t, w.Body.String(), "private")
			assert.Empty(t, w.Header().Get("Retry-After"))
		})
	}
	for _, tc := range []struct {
		status int
		code   string
	}{{402, "insufficient_user_quota"}, {403, "401008"}} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		upstream := types.NewOpenAIError(errors.New("private upstream balance"), types.ErrorCode(tc.code), tc.status)
		service.NormalizeRelayServiceFault(upstream)
		fault := service.TaskErrorFromAPIError(upstream)
		assert.False(t, fault.LocalError)
		assert.Equal(t, tc.status, fault.StatusCode)
		respondTaskError(c, fault)
		assert.Equal(t, 503, w.Code)
		assert.Contains(t, w.Body.String(), "model_temporarily_unavailable")
		assert.NotContains(t, w.Body.String(), "top up")
		assert.NotContains(t, w.Body.String(), "private")
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	respondTaskError(c, service.TaskErrorFromAPIError(types.NewError(errors.New("private database details"), types.ErrorCodeQueryDataError)))
	assert.Equal(t, 500, w.Code)
	assert.NotContains(t, w.Body.String(), "private")
}

func TestSubscriptionBalanceFailureHasFundingCode(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.SubscriptionPlan{}))
	user := model.User{Username: "funding-purchase", Quota: 1}
	require.NoError(t, db.Create(&user).Error)
	plan := model.SubscriptionPlan{Title: "funding-purchase", PriceAmount: 10, Enabled: true}
	require.NoError(t, db.Create(&plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	body, err := common.Marshal(SubscriptionBalancePayRequest{PlanId: plan.Id})
	require.NoError(t, err)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("id", user.Id)
	c.Request = httptest.NewRequest("POST", "/api/subscription/balance/pay", strings.NewReader(string(body)))
	c.Request.Header.Set("Content-Type", "application/json")
	SubscriptionRequestBalancePay(c)
	assert.Equal(t, 200, w.Code)
	var response struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, "insufficient_user_quota", response.Code)
	assert.Contains(t, response.Message, "top up")
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, 1, user.Quota)
}

func TestRelayAttemptLogsProduceOneFinalError(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousLogging, previousRedis := constant.ErrorLogEnabled, common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.User{}))
	model.DB, model.LOG_DB = db, db
	constant.ErrorLogEnabled, common.RedisEnabled = true, false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		constant.ErrorLogEnabled, common.RedisEnabled = previousLogging, previousRedis
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.Create(&model.User{Id: 98351, Username: "retry-log-fixture"}).Error)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/videos", nil)
	c.Set("id", 98351)
	c.Set("channel_id", 7)
	c.Set(common.RequestIdKey, "gateway-request")
	c.Set(common.UpstreamRequestIdKey, "cpa-attempt-1")
	c.Set("use_channel", []string{"7"})
	fault := types.NewOpenAIError(errors.New("private supplier details"), types.ErrorCodeBadResponseStatusCode, 503)
	service.NormalizeRelayServiceFault(fault)
	channel := types.NewChannelError(7, 1, "fixture", false, "", false)
	c.Set("relay_retry_attempt", true)
	processChannelError(c, *channel, fault)
	var count int64
	require.NoError(t, db.Model(&model.Log{}).Count(&count).Error)
	assert.Zero(t, count)
	c.Set("relay_retry_attempt", false)
	processChannelError(c, *channel, fault)
	var logs []model.Log
	require.NoError(t, db.Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, "gateway-request", logs[0].RequestId)
	assert.Equal(t, "cpa-attempt-1", logs[0].UpstreamRequestId)
	assert.NotContains(t, logs[0].Content, "private")
	var other struct {
		AdminInfo struct {
			Attempts []map[string]any `json:"attempts"`
		} `json:"admin_info"`
	}
	require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
	require.Len(t, other.AdminInfo.Attempts, 1)
	assert.Equal(t, float64(503), other.AdminInfo.Attempts[0]["status_code"])
}
