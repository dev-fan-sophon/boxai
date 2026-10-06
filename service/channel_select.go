package service

import (
	"errors"
	"slices"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
)

type RetryParam struct {
	Ctx         *gin.Context
	TokenGroup  string
	ModelName   string
	RequestPath string
	Retry       *int
	// ChannelFilter, when set, narrows selection to channels it accepts.
	// Rejected channels are skipped like attempted ones, so selection moves to
	// the remaining channels of the same group before changing groups.
	ChannelFilter func(*model.Channel) bool
	resetNextTry  bool
}

func (p *RetryParam) GetRetry() int {
	if p.Retry == nil {
		return 0
	}
	return *p.Retry
}

func (p *RetryParam) SetRetry(retry int) {
	p.Retry = &retry
}

func (p *RetryParam) IncreaseRetry() {
	if p.resetNextTry {
		p.resetNextTry = false
		return
	}
	if p.Retry == nil {
		p.Retry = new(int)
	}
	*p.Retry++
}

func (p *RetryParam) ResetRetryNextTry() {
	p.resetNextTry = true
}

// CacheGetRandomSatisfiedChannel tries to get a random channel that satisfies the requirements.
// 尝试获取一个满足要求的随机渠道。
//
// For "auto" tokenGroup with cross-group Retry enabled:
// 对于启用了跨分组重试的 "auto" tokenGroup：
//
//   - Each group will exhaust all its priorities before moving to the next group.
//     每个分组会用完所有优先级后才会切换到下一个分组。
//
//   - Uses ContextKeyAutoGroupIndex to track current group index.
//     使用 ContextKeyAutoGroupIndex 跟踪当前分组索引。
//
//   - Uses ContextKeyAutoGroupRetryIndex to track the global Retry count when current group started.
//     使用 ContextKeyAutoGroupRetryIndex 跟踪当前分组开始时的全局重试次数。
//
//   - priorityRetry = Retry - startRetryIndex, represents the priority level within current group.
//     priorityRetry = Retry - startRetryIndex，表示当前分组内的优先级级别。
//
//   - When GetRandomSatisfiedChannel returns nil (priorities exhausted), moves to next group.
//     当 GetRandomSatisfiedChannel 返回 nil（优先级用完）时，切换到下一个分组。
//
// Example flow (2 groups, each with 2 priorities, RetryTimes=3):
// 示例流程（2个分组，每个有2个优先级，RetryTimes=3）：
//
//	Retry=0: GroupA, priority0 (startRetryIndex=0, priorityRetry=0)
//	         分组A, 优先级0
//
//	Retry=1: GroupA, priority1 (startRetryIndex=0, priorityRetry=1)
//	         分组A, 优先级1
//
//	Retry=2: GroupA exhausted → GroupB, priority0 (startRetryIndex=2, priorityRetry=0)
//	         分组A用完 → 分组B, 优先级0
//
//	Retry=3: GroupB, priority1 (startRetryIndex=2, priorityRetry=1)
//	         分组B, 优先级1
//
// Channels already attempted by this request (recorded as IDs in the "use_channel"
// context slice) are never selected again. With exclusions, each group picks from
// its highest remaining priority level, so untried same-priority channels come
// before lower ones. When a group runs out of untried channels after a group has
// already been selected for the request, selection moves to the next auto group
// only if cross-group retry is enabled; otherwise it returns a nil channel.
// 本次请求已尝试过的渠道（记录在 "use_channel" 上下文中）不会被再次选择。
func CacheGetRandomSatisfiedChannel(param *RetryParam) (*model.Channel, string, error) {
	var channel *model.Channel
	var err error
	selectGroup := param.TokenGroup
	userGroup := common.GetContextKeyString(param.Ctx, constant.ContextKeyUserGroup)
	excludedChannelIds := attemptedChannelIds(param.Ctx)

	if param.TokenGroup == "auto" {
		autoGroups := GetRequestAutoGroups(param.Ctx, userGroup)
		if len(autoGroups) == 0 {
			return nil, selectGroup, errors.New("auto groups is not enabled")
		}

		// startGroupIndex: the group index to start searching from
		// startGroupIndex: 开始搜索的分组索引
		startGroupIndex := 0
		crossGroupRetry := common.GetContextKeyBool(param.Ctx, constant.ContextKeyTokenCrossGroupRetry)

		// groupSelected reports whether a group already served this request
		// (normal selection or channel affinity). Without cross-group retry the
		// request must then stay in that group.
		groupSelected := false
		if lastGroupIndex, exists := common.GetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex); exists {
			if idx, ok := lastGroupIndex.(int); ok {
				startGroupIndex = idx
				groupSelected = true
			}
		} else if selectedAutoGroup := common.GetContextKeyString(param.Ctx, constant.ContextKeyAutoGroup); selectedAutoGroup != "" {
			if idx := slices.Index(autoGroups, selectedAutoGroup); idx >= 0 {
				startGroupIndex = idx
				groupSelected = true
			}
		}

		for i := startGroupIndex; i < len(autoGroups); i++ {
			autoGroup := autoGroups[i]
			// Calculate priorityRetry for current group
			// 计算当前分组的 priorityRetry
			priorityRetry := param.GetRetry()
			// If moved to a new group, reset priorityRetry and update startRetryIndex
			// 如果切换到新分组，重置 priorityRetry 并更新 startRetryIndex
			if i > startGroupIndex {
				priorityRetry = 0
			}
			logger.LogDebug(param.Ctx, "Auto selecting group: %s, priorityRetry: %d", autoGroup, priorityRetry)

			channel, excludedChannelIds, _ = getFilteredRandomSatisfiedChannel(param, autoGroup, priorityRetry, excludedChannelIds)
			if channel == nil {
				if groupSelected && !crossGroupRetry {
					// The selected group has no untried channel left and cross-group retry is off.
					// 已选分组没有未尝试的渠道，且未开启跨分组重试。
					logger.LogDebug(param.Ctx, "No untried channel left in group %s for model %s and cross-group retry is disabled", autoGroup, param.ModelName)
					break
				}
				// Current group has no available channel for this model, try next group
				// 当前分组没有该模型的可用渠道，尝试下一个分组
				logger.LogDebug(param.Ctx, "No available channel in group %s for model %s at priorityRetry %d, trying next group", autoGroup, param.ModelName, priorityRetry)
				// 重置状态以尝试下一个分组
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupRetryIndex, 0)
				// Reset retry counter so outer loop can continue for next group
				// 重置重试计数器，以便外层循环可以为下一个分组继续
				param.SetRetry(0)
				continue
			}
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroup, autoGroup)
			selectGroup = autoGroup
			logger.LogDebug(param.Ctx, "Auto selected group: %s", autoGroup)

			// Prepare state for next retry
			// 为下一次重试准备状态
			if crossGroupRetry && priorityRetry >= common.RetryTimes {
				// Current group has exhausted all retries, prepare to switch to next group
				// This request still uses current group, but next retry will use next group
				// 当前分组已用完所有重试次数，准备切换到下一个分组
				// 本次请求仍使用当前分组，但下次重试将使用下一个分组
				logger.LogDebug(param.Ctx, "Current group %s retries exhausted (priorityRetry=%d >= RetryTimes=%d), preparing switch to next group for next retry", autoGroup, priorityRetry, common.RetryTimes)
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
				// Reset retry counter so outer loop can continue for next group
				// 重置重试计数器，以便外层循环可以为下一个分组继续
				param.SetRetry(0)
				param.ResetRetryNextTry()
			} else {
				// Stay in current group, save current state
				// 保持在当前分组，保存当前状态
				common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i)
			}
			break
		}
	} else {
		channel, _, err = getFilteredRandomSatisfiedChannel(param, param.TokenGroup, param.GetRetry(), excludedChannelIds)
		if err != nil {
			return nil, param.TokenGroup, err
		}
	}
	return channel, selectGroup, nil
}

// maxFilteredChannelSkips bounds how many filter-rejected channels one
// selection may skip, so a misconfigured filter cannot spin indefinitely.
const maxFilteredChannelSkips = 256

// getFilteredRandomSatisfiedChannel selects from group while skipping channels
// rejected by param.ChannelFilter. It returns the exclusions it accumulated so
// an auto-group scan keeps skipping them in later groups.
func getFilteredRandomSatisfiedChannel(param *RetryParam, group string, retry int, excludedChannelIds []int) (*model.Channel, []int, error) {
	for range maxFilteredChannelSkips {
		channel, err := model.GetRandomSatisfiedChannel(group, param.ModelName, retry, param.RequestPath, excludedChannelIds...)
		if err != nil || channel == nil || param.ChannelFilter == nil || param.ChannelFilter(channel) {
			return channel, excludedChannelIds, err
		}
		excludedChannelIds = append(slices.Clone(excludedChannelIds), channel.Id)
	}
	return nil, excludedChannelIds, nil
}

// attemptedChannelIds returns the channel IDs this request has already been sent to.
func attemptedChannelIds(c *gin.Context) []int {
	if c == nil {
		return nil
	}
	var ids []int
	for _, raw := range c.GetStringSlice("use_channel") {
		id, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil || id <= 0 {
			continue
		}
		ids = append(ids, id)
	}
	return ids
}
