package service

import (
	"fmt"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func createExclusionChannel(t *testing.T, db *gorm.DB, id int, groups []string, modelName string, priority int64) {
	t.Helper()
	weight := uint(100)
	require.NoError(t, db.Create(&model.Channel{
		Id:       id,
		Type:     constant.ChannelTypeOpenAI,
		Key:      fmt.Sprintf("key-%d", id),
		Status:   common.ChannelStatusEnabled,
		Name:     fmt.Sprintf("channel-%d", id),
		Weight:   &weight,
		Models:   modelName,
		Group:    strings.Join(groups, ","),
		Priority: &priority,
	}).Error)
	for _, group := range groups {
		require.NoError(t, db.Create(&model.Ability{
			Group:     group,
			Model:     modelName,
			ChannelId: id,
			Enabled:   true,
			Priority:  &priority,
			Weight:    weight,
		}).Error)
	}
}

// useDatabaseChannelSelection disables the memory cache so selection goes
// through the abilities table, initializing dialect column names on the test DB.
func useDatabaseChannelSelection(t *testing.T) {
	t.Helper()
	originalLogDB := model.LOG_DB
	t.Cleanup(func() { model.LOG_DB = originalLogDB })
	t.Setenv("LOG_SQL_DSN", "")
	require.NoError(t, model.InitLogDB())
	common.MemoryCacheEnabled = false
}

func newExclusionRetryContext(userGroup string) *gin.Context {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, userGroup)
	return ctx
}

// recordAttempt mirrors controller.addUsedChannel.
func recordAttempt(ctx *gin.Context, channel *model.Channel) {
	ctx.Set("use_channel", append(ctx.GetStringSlice("use_channel"), strconv.Itoa(channel.Id)))
}

func TestCacheGetRandomSatisfiedChannelRetriesUntriedChannelsThenExhausts(t *testing.T) {
	for _, memoryCache := range []bool{true, false} {
		t.Run(fmt.Sprintf("memory_cache=%v", memoryCache), func(t *testing.T) {
			db := setupChannelSelectAutoGroupsTest(t)
			if !memoryCache {
				useDatabaseChannelSelection(t)
			}
			common.RetryTimes = 5
			const modelName = "exclusion-retry-model"
			createExclusionChannel(t, db, 4101, []string{"default"}, modelName, 10)
			createExclusionChannel(t, db, 4102, []string{"default"}, modelName, 10)
			createExclusionChannel(t, db, 4103, []string{"default"}, modelName, 5)
			if memoryCache {
				model.InitChannelCache()
			}

			ctx := newExclusionRetryContext("default")
			param := &RetryParam{Ctx: ctx, TokenGroup: "default", ModelName: modelName, RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0)}

			first, group, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, first)
			assert.Equal(t, "default", group)
			assert.Contains(t, []int{4101, 4102}, first.Id)
			recordAttempt(ctx, first)

			param.IncreaseRetry()
			second, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, second)
			assert.Contains(t, []int{4101, 4102}, second.Id)
			assert.NotEqual(t, first.Id, second.Id, "retry must try the other same-priority channel")
			recordAttempt(ctx, second)

			param.IncreaseRetry()
			third, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			require.NotNil(t, third)
			assert.Equal(t, 4103, third.Id)
			recordAttempt(ctx, third)

			param.IncreaseRetry()
			exhausted, _, err := CacheGetRandomSatisfiedChannel(param)
			require.NoError(t, err)
			assert.Nil(t, exhausted)
		})
	}
}

func TestCacheGetRandomSatisfiedChannelSingleChannelExhausts(t *testing.T) {
	db := setupChannelSelectAutoGroupsTest(t)
	common.RetryTimes = 3
	const modelName = "exclusion-single-model"
	createExclusionChannel(t, db, 4201, []string{"default"}, modelName, 0)
	model.InitChannelCache()

	ctx := newExclusionRetryContext("default")
	param := &RetryParam{Ctx: ctx, TokenGroup: "default", ModelName: modelName, RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0)}

	first, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 4201, first.Id)
	recordAttempt(ctx, first)

	param.IncreaseRetry()
	retried, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	assert.Nil(t, retried, "the only channel was already attempted")
}

func TestCacheGetRandomSatisfiedChannelAutoGroupStaysWithoutCrossGroupRetry(t *testing.T) {
	db := setupChannelSelectAutoGroupsTest(t)
	common.RetryTimes = 3
	const modelName = "exclusion-auto-no-cross-model"
	createExclusionChannel(t, db, 4301, []string{"vip"}, modelName, 0)
	createExclusionChannel(t, db, 4302, []string{"default"}, modelName, 0)
	model.InitChannelCache()

	ctx := newExclusionRetryContext("default")
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"vip", "default"})
	common.SetContextKey(ctx, constant.ContextKeyTokenCrossGroupRetry, false)
	param := &RetryParam{Ctx: ctx, TokenGroup: "auto", ModelName: modelName, RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0)}

	first, group, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, 4301, first.Id)
	assert.Equal(t, "vip", group)
	recordAttempt(ctx, first)

	param.IncreaseRetry()
	retried, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	assert.Nil(t, retried, "must not move to another auto group without cross-group retry")
	assert.Equal(t, "vip", common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup))
}

func TestCacheGetRandomSatisfiedChannelAutoGroupAffinityStaysWithoutCrossGroupRetry(t *testing.T) {
	db := setupChannelSelectAutoGroupsTest(t)
	common.RetryTimes = 3
	const modelName = "exclusion-auto-affinity-model"
	createExclusionChannel(t, db, 4351, []string{"vip"}, modelName, 0)
	createExclusionChannel(t, db, 4352, []string{"default"}, modelName, 0)
	model.InitChannelCache()

	// Channel affinity selected 4352 in "default" without recording a group index.
	ctx := newExclusionRetryContext("default")
	common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"vip", "default"})
	common.SetContextKey(ctx, constant.ContextKeyAutoGroup, "default")
	ctx.Set("use_channel", []string{"4352"})
	param := &RetryParam{Ctx: ctx, TokenGroup: "auto", ModelName: modelName, RequestPath: "/v1/chat/completions", Retry: common.GetPointer(1)}

	retried, _, err := CacheGetRandomSatisfiedChannel(param)
	require.NoError(t, err)
	assert.Nil(t, retried, "affinity-selected group is the request's group; no cross-group retry")
}

func TestCacheGetRandomSatisfiedChannelAutoGroupCrossGroupRetryExcludesAcrossGroups(t *testing.T) {
	for _, memoryCache := range []bool{true, false} {
		t.Run(fmt.Sprintf("memory_cache=%v", memoryCache), func(t *testing.T) {
			db := setupChannelSelectAutoGroupsTest(t)
			if !memoryCache {
				useDatabaseChannelSelection(t)
			}
			common.RetryTimes = 5
			const modelName = "exclusion-auto-cross-model"
			createExclusionChannel(t, db, 4401, []string{"vip"}, modelName, 0)
			// 4402 belongs to both groups and must not be retried in "default" after "vip".
			createExclusionChannel(t, db, 4402, []string{"vip", "default"}, modelName, 0)
			createExclusionChannel(t, db, 4403, []string{"default"}, modelName, 0)
			if memoryCache {
				model.InitChannelCache()
			}

			ctx := newExclusionRetryContext("default")
			common.SetContextKey(ctx, constant.ContextKeyTokenAutoGroups, []string{"vip", "default"})
			common.SetContextKey(ctx, constant.ContextKeyTokenCrossGroupRetry, true)
			param := &RetryParam{Ctx: ctx, TokenGroup: "auto", ModelName: modelName, RequestPath: "/v1/chat/completions", Retry: common.GetPointer(0)}

			selected := make([]int, 0, 3)
			groups := make([]string, 0, 3)
			for attempt := 0; attempt < 3; attempt++ {
				channel, group, err := CacheGetRandomSatisfiedChannel(param)
				require.NoError(t, err)
				require.NotNil(t, channel, "attempt %d", attempt)
				selected = append(selected, channel.Id)
				groups = append(groups, group)
				recordAttempt(ctx, channel)
				param.IncreaseRetry()
			}
			assert.ElementsMatch(t, []int{4401, 4402}, selected[:2])
			assert.Equal(t, []string{"vip", "vip", "default"}, groups)
			assert.Equal(t, 4403, selected[2])

			// All authorized groups are exhausted: selection stays nil instead of restarting.
			for attempt := 0; attempt < 2; attempt++ {
				channel, _, err := CacheGetRandomSatisfiedChannel(param)
				require.NoError(t, err)
				assert.Nil(t, channel)
				param.IncreaseRetry()
			}
		})
	}
}
