package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
)

// LogTaskConsumption 记录任务消费日志和统计信息（仅记录，不涉及实际扣费）。
// 实际扣费已由 BillingSession（PreConsumeBilling + SettleBilling）完成。
func LogTaskConsumption(c *gin.Context, info *relaycommon.RelayInfo) {
	tokenName := c.GetString("token_name")
	logContent := fmt.Sprintf("操作 %s", info.Action)
	// 支持任务仅按次计费
	if common.StringsContains(constant.TaskPricePatches, info.OriginModelName) {
		logContent = fmt.Sprintf("%s，按次计费", logContent)
	} else {
		if otherRatios := info.PriceData.OtherRatios(); len(otherRatios) > 0 {
			var contents []string
			for key, ra := range otherRatios {
				if 1.0 != ra {
					contents = append(contents, fmt.Sprintf("%s: %.2f", key, ra))
				}
			}
			if len(contents) > 0 {
				logContent = fmt.Sprintf("%s, 计算参数：%s", logContent, strings.Join(contents, ", "))
			}
		}
	}
	other := make(map[string]interface{})
	other["is_task"] = true
	other["request_path"] = c.Request.URL.Path
	other["model_price"] = info.PriceData.ModelPrice
	if info.PriceData.ModelRatio > 0 {
		other["model_ratio"] = info.PriceData.ModelRatio
	}
	other["group_ratio"] = info.PriceData.GroupRatioInfo.GroupRatio
	if info.PriceData.GroupRatioInfo.HasSpecialRatio {
		other["user_group_ratio"] = info.PriceData.GroupRatioInfo.GroupSpecialRatio
	}
	if info.IsModelMapped {
		other["is_model_mapped"] = true
		other["upstream_model_name"] = info.UpstreamModelName
	}
	attachQuotaSaturation(c, info, other)
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId,
		ModelName: info.OriginModelName,
		TokenName: tokenName,
		Quota:     info.PriceData.Quota,
		Content:   logContent,
		TokenId:   info.TokenId,
		Group:     info.UsingGroup,
		Other:     other,
	})
	model.UpdateUserUsedQuotaAndRequestCount(info.UserId, info.PriceData.Quota)
	model.UpdateChannelUsedQuota(info.ChannelId, info.PriceData.Quota)
}

// taskBillingOther 从 task 的 BillingContext 构建日志 Other 字段。
func taskBillingOther(task *model.Task) map[string]interface{} {
	other := make(map[string]interface{})
	if bc := task.PrivateData.BillingContext; bc != nil {
		other["model_price"] = bc.ModelPrice
		if bc.ModelRatio > 0 {
			other["model_ratio"] = bc.ModelRatio
		}
		other["group_ratio"] = bc.GroupRatio
		if priceData := taskBillingContextPriceData(bc); priceData != nil {
			for k, v := range priceData.OtherRatios() {
				other[k] = v
			}
		}
	}
	props := task.Properties
	if props.UpstreamModelName != "" && props.UpstreamModelName != props.OriginModelName {
		other["is_model_mapped"] = true
		other["upstream_model_name"] = props.UpstreamModelName
	}
	return other
}

func taskBillingContextPriceData(bc *model.TaskBillingContext) *types.PriceData {
	if bc == nil || len(bc.OtherRatios) == 0 {
		return nil
	}
	priceData := &types.PriceData{}
	if !priceData.ReplaceOtherRatios(bc.OtherRatios) {
		return nil
	}
	return priceData
}

// taskModelName 从 BillingContext 或 Properties 中获取模型名称。
func taskModelName(task *model.Task) string {
	if bc := task.PrivateData.BillingContext; bc != nil && bc.OriginModelName != "" {
		return bc.OriginModelName
	}
	return task.Properties.OriginModelName
}

func initialOperationKey(key string) string {
	if strings.HasPrefix(key, "async:") && strings.HasSuffix(key, ":initial") {
		return key
	}
	return "async:" + key + ":initial"
}

// taskInitialBillingOperation resolves the immutable committed charge. The
// zero-delta branch is a one-time reader/backfill for terminal tasks created by
// releases predating BillingOperation; new writes always persist the key.
func taskInitialBillingOperation(task *model.Task) (*model.BillingOperation, error) {
	if task.ID == 0 {
		if err := model.DB.Create(task).Error; err != nil {
			return nil, err
		}
	}
	key := task.PrivateData.BillingOperationKey
	if key == "" {
		key = fmt.Sprintf("legacy:task:%d", task.ID)
	}
	operationKey := initialOperationKey(key)
	if operation, err := model.GetCommittedBillingOperation(operationKey); err == nil {
		return operation, nil
	}
	usageGeneration := task.PrivateData.SubscriptionUsageGeneration
	if task.PrivateData.BillingSource == BillingSourceSubscription && usageGeneration == 0 {
		usageGeneration = model.UnknownSubscriptionUsageGeneration
	}
	operation, _, err := model.ApplyBillingOperation(model.BillingOperationInput{
		IdempotencyKey: operationKey, Kind: model.BillingOperationInitial,
		UserID: task.UserId, TokenID: task.PrivateData.TokenId, SubscriptionID: task.PrivateData.SubscriptionId,
		SubscriptionUsageGeneration: usageGeneration,
		BillingSource:               task.PrivateData.BillingSource, Delta: 0, ChargedQuota: task.Quota,
		ReferenceKey: operationKey,
	})
	return operation, err
}

func settleTaskBillingOperation(task *model.Task, actualQuota int) (bool, error) {
	if task.Quota == 0 && task.PrivateData.BillingOperationKey == "" {
		err := model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Update("billing_settled", true).Error
		task.BillingSettled = err == nil
		return false, err
	}
	initial, err := taskInitialBillingOperation(task)
	if err != nil {
		return false, err
	}
	_, applied, err := model.ApplyBillingOperation(model.BillingOperationInput{
		IdempotencyKey: fmt.Sprintf("%s:settle:%d", initial.IdempotencyKey, actualQuota), Kind: model.BillingOperationSettle,
		UserID: initial.UserID, TokenID: initial.TokenID, SubscriptionID: initial.SubscriptionID,
		SubscriptionUsageGeneration: initial.SubscriptionUsageGeneration,
		BillingSource:               initial.BillingSource, ChargedQuota: actualQuota, ReferenceKey: initial.IdempotencyKey,
		SetChargeToTarget: true,
	})
	if err != nil {
		return false, err
	}
	if err := model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"quota": actualQuota, "billing_settled": true}).Error; err != nil {
		return false, err
	}
	task.Quota = actualQuota
	task.BillingSettled = true
	return applied, nil
}

func RefundMidjourneyQuota(ctx context.Context, task *model.Midjourney) bool {
	if task.Quota == 0 {
		return true
	}
	key := task.BillingOperationKey
	if key == "" {
		key = fmt.Sprintf("legacy:midjourney:%d", task.Id)
	}
	initialKey := initialOperationKey(key)
	initial, err := model.GetCommittedBillingOperation(initialKey)
	if err != nil {
		usageGeneration := task.SubscriptionUsageGeneration
		if task.BillingSource == BillingSourceSubscription && usageGeneration == 0 {
			usageGeneration = model.UnknownSubscriptionUsageGeneration
		}
		initial, _, err = model.ApplyBillingOperation(model.BillingOperationInput{
			IdempotencyKey: initialKey, Kind: model.BillingOperationInitial, UserID: task.UserId,
			TokenID: task.TokenId, SubscriptionID: task.SubscriptionId, BillingSource: task.BillingSource,
			SubscriptionUsageGeneration: usageGeneration,
			Delta:                       0, ChargedQuota: task.Quota, ReferenceKey: initialKey,
		})
	}
	if err != nil {
		return false
	}
	_, _, err = model.ApplyBillingOperation(model.BillingOperationInput{
		IdempotencyKey: initial.IdempotencyKey + ":refund", Kind: model.BillingOperationRefund,
		UserID: initial.UserID, TokenID: initial.TokenID, SubscriptionID: initial.SubscriptionID,
		SubscriptionUsageGeneration: initial.SubscriptionUsageGeneration,
		BillingSource:               initial.BillingSource, ChargedQuota: 0, ReferenceKey: initial.IdempotencyKey,
		SetChargeToTarget: true,
	})
	if err != nil {
		return false
	}
	if err := model.DB.Model(&model.Midjourney{}).Where("id = ? AND quota != 0", task.Id).Updates(map[string]any{"quota": 0, "billing_settled": true}).Error; err != nil {
		return false
	}
	task.Quota = 0
	task.BillingSettled = true
	ReconcileBillingOperationProjections(ctx)
	return true
}

// RefundTaskQuota 统一的任务失败退款逻辑。
// 当异步任务失败时，将预扣的 quota 退还给用户（支持钱包和订阅），并退还令牌额度。
func RefundTaskQuota(ctx context.Context, task *model.Task, reason string) bool {
	quota := task.Quota
	if quota == 0 {
		return true
	}
	if quota < 0 {
		logger.LogError(ctx, fmt.Sprintf("拒绝负数 task quota 退款 task %s: %d", task.TaskID, quota))
		return false
	}
	initial, err := taskInitialBillingOperation(task)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("resolve task billing operation failed task %s: %s", task.TaskID, err.Error()))
		return false
	}
	operation, applied, err := model.ApplyBillingOperation(model.BillingOperationInput{
		IdempotencyKey: initial.IdempotencyKey + ":refund", Kind: model.BillingOperationRefund,
		UserID: initial.UserID, TokenID: initial.TokenID, SubscriptionID: initial.SubscriptionID,
		SubscriptionUsageGeneration: initial.SubscriptionUsageGeneration,
		BillingSource:               initial.BillingSource, ChargedQuota: 0, ReferenceKey: initial.IdempotencyKey,
		SetChargeToTarget: true,
	})
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("durable task refund failed task %s: %s", task.TaskID, err.Error()))
		return false
	}
	if err := model.DB.Model(&model.Task{}).Where("id = ? AND quota != 0", task.ID).Updates(map[string]any{"quota": 0, "billing_settled": true}).Error; err != nil {
		return false
	}
	task.Quota = 0
	task.BillingSettled = true
	ReconcileBillingOperationProjections(ctx)
	if !applied {
		return true
	}
	other := taskBillingOther(task)
	other["task_id"] = task.TaskID
	other["reason"] = reason
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
		UserId:    task.UserId,
		LogType:   model.LogTypeRefund,
		Content:   "",
		ChannelId: task.ChannelId,
		ModelName: taskModelName(task),
		Quota:     -operation.Delta,
		TokenId:   operation.TokenID,
		Group:     task.Group,
		Other:     other,
	})

	return true
}

// ReconcileTaskRefunds recovers failures that happened after the terminal CAS
// but before (or during) refund processing.
func ReconcileTaskRefunds(ctx context.Context) {
	ReconcileBillingOperationProjections(ctx)
	for _, task := range model.GetPendingTerminalTaskRefunds(100) {
		RefundTaskQuota(ctx, task, task.FailReason)
	}
	for _, task := range model.GetPendingTerminalTaskSettlements(100) {
		if _, err := settleTaskBillingOperation(task, task.Quota); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("durable task settlement recovery failed task %s: %v", task.TaskID, err))
		}
	}
}

func ReconcileBillingOperationProjections(ctx context.Context) {
	for _, operation := range model.PendingBillingOperationProjections(100) {
		if err := model.InvalidateUserCache(operation.UserID); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("billing cache projection failed operation %d: %v", operation.ID, err))
			continue
		}
		if operation.TokenID > 0 {
			if err := model.InvalidateUserTokensCache(operation.UserID); err != nil {
				continue
			}
		}
		_ = model.CompleteBillingOperationProjection(operation.ID)
	}
}

// ReconcileMidjourneyRefunds projects terminal Midjourney failures through the
// same durable wallet/token semantics used by canonical async tasks.
func ReconcileMidjourneyRefunds(ctx context.Context) {
	for _, task := range model.PendingMidjourneyRefundTasks(100) {
		if !RefundMidjourneyQuota(ctx, &task) {
			logger.LogWarn(ctx, fmt.Sprintf("durable Midjourney refund failed task %s", task.MjId))
		}
	}
	for _, task := range model.PendingMidjourneySettlementTasks(100) {
		SettleMidjourneyQuota(ctx, &task)
	}
}

func SettleMidjourneyQuota(ctx context.Context, task *model.Midjourney) bool {
	if task.Quota == 0 || task.BillingOperationKey == "" {
		err := model.DB.Model(&model.Midjourney{}).Where("id = ?", task.Id).Update("billing_settled", true).Error
		return err == nil
	}
	initial, err := model.GetCommittedBillingOperation(initialOperationKey(task.BillingOperationKey))
	if err != nil {
		return false
	}
	_, _, err = model.ApplyBillingOperation(model.BillingOperationInput{
		IdempotencyKey: initial.IdempotencyKey + ":settle", Kind: model.BillingOperationSettle,
		UserID: initial.UserID, TokenID: initial.TokenID, SubscriptionID: initial.SubscriptionID,
		SubscriptionUsageGeneration: initial.SubscriptionUsageGeneration,
		BillingSource:               initial.BillingSource, ChargedQuota: initial.ChargedQuota, ReferenceKey: initial.IdempotencyKey,
		SetChargeToTarget: true,
	})
	if err != nil {
		return false
	}
	if err := model.DB.Model(&model.Midjourney{}).Where("id = ?", task.Id).Update("billing_settled", true).Error; err != nil {
		return false
	}
	task.BillingSettled = true
	ReconcileBillingOperationProjections(ctx)
	return true
}

// RecalculateTaskQuota 通用的异步差额结算。
// actualQuota 是任务完成后的实际应扣额度，与预扣额度 (task.Quota) 做差额结算。
// reason 用于日志记录（例如 "token重算" 或 "adaptor调整"）。
// clamps 可选：若计算 actualQuota 时发生额度饱和，将其记入日志 admin_info（仅管理员可见）。
func RecalculateTaskQuota(ctx context.Context, task *model.Task, actualQuota int, reason string, clamps ...*common.QuotaClamp) {
	if actualQuota <= 0 {
		return
	}
	preConsumedQuota := task.Quota
	if preConsumedQuota < 0 {
		logger.LogError(ctx, fmt.Sprintf("拒绝负数 task quota 差额结算 task %s: %d", task.TaskID, preConsumedQuota))
		return
	}
	quotaDelta := actualQuota - preConsumedQuota
	if task.ID == 0 {
		if err := model.DB.Create(task).Error; err != nil {
			logger.LogError(ctx, fmt.Sprintf("差额结算任务持久化失败 task %s: %s", task.TaskID, err.Error()))
			return
		}
	}

	if quotaDelta == 0 {
		_, _ = settleTaskBillingOperation(task, actualQuota)
		logger.LogInfo(ctx, fmt.Sprintf("任务 %s 预扣费准确（%s，%s）",
			task.TaskID, logger.LogQuota(actualQuota), reason))
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("任务 %s 差额结算：delta=%s（实际：%s，预扣：%s，%s）",
		task.TaskID,
		logger.LogQuota(quotaDelta),
		logger.LogQuota(actualQuota),
		logger.LogQuota(preConsumedQuota),
		reason,
	))

	applied, err := settleTaskBillingOperation(task, actualQuota)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("durable task settlement failed task %s: %s", task.TaskID, err.Error()))
		return
	}
	if !applied {
		return
	}

	var logType int
	var logQuota int
	if quotaDelta > 0 {
		logType = model.LogTypeConsume
		logQuota = quotaDelta
		model.UpdateUserUsedQuotaAndRequestCount(task.UserId, quotaDelta)
		model.UpdateChannelUsedQuota(task.ChannelId, quotaDelta)
	} else {
		logType = model.LogTypeRefund
		logQuota = -quotaDelta
	}
	other := taskBillingOther(task)
	other["task_id"] = task.TaskID
	other["pre_consumed_quota"] = preConsumedQuota
	other["actual_quota"] = actualQuota
	for _, clamp := range clamps {
		attachQuotaSaturationToOther(other, clamp)
	}
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
		UserId:    task.UserId,
		LogType:   logType,
		Content:   reason,
		ChannelId: task.ChannelId,
		ModelName: taskModelName(task),
		Quota:     logQuota,
		TokenId:   task.PrivateData.TokenId,
		Group:     task.Group,
		Other:     other,
		NodeName:  task.PrivateData.NodeName,
	})
}

// RecalculateTaskQuotaByTokens 根据实际 token 消耗重新计费（异步差额结算）。
// 当任务成功且返回了 totalTokens 时，根据模型倍率和分组倍率重新计算实际扣费额度，
// 与预扣费的差额进行补扣或退还。支持钱包和订阅计费来源。
func RecalculateTaskQuotaByTokens(ctx context.Context, task *model.Task, totalTokens int) {
	if totalTokens <= 0 {
		return
	}

	modelName := taskModelName(task)

	// 获取模型价格和倍率
	modelRatio, hasRatioSetting, _ := ratio_setting.GetModelRatio(modelName)
	// 只有配置了倍率(非固定价格)时才按 token 重新计费
	if !hasRatioSetting || modelRatio <= 0 {
		return
	}

	// 获取用户和组的倍率信息
	group := task.Group
	if group == "" {
		user, err := model.GetUserById(task.UserId, false)
		if err == nil {
			group = user.Group
		}
	}
	if group == "" {
		return
	}

	groupRatio := ratio_setting.GetGroupRatio(group)
	userGroupRatio, hasUserGroupRatio := ratio_setting.GetGroupGroupRatio(group, group)

	var finalGroupRatio float64
	if hasUserGroupRatio {
		finalGroupRatio = userGroupRatio
	} else {
		finalGroupRatio = groupRatio
	}

	// 计算 OtherRatios 乘积（视频折扣、时长等）
	otherMultiplier := 1.0
	if priceData := taskBillingContextPriceData(task.PrivateData.BillingContext); priceData != nil {
		otherMultiplier = priceData.OtherRatioMultiplier()
	}

	// 计算实际应扣费额度: totalTokens * modelRatio * groupRatio * otherMultiplier（饱和转换，防止溢出成负数）
	actualQuota, clamp := common.QuotaFromFloatChecked(float64(totalTokens) * modelRatio * finalGroupRatio * otherMultiplier)

	reason := fmt.Sprintf("token重算：tokens=%d, modelRatio=%.2f, groupRatio=%.2f, otherMultiplier=%.4f", totalTokens, modelRatio, finalGroupRatio, otherMultiplier)
	RecalculateTaskQuota(ctx, task, actualQuota, reason, clamp)
}
