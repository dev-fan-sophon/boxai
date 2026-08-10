package service

import (
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// ---------------------------------------------------------------------------
// BillingSession — 统一计费会话
// ---------------------------------------------------------------------------

// BillingSession 封装单次请求的预扣费/结算/退款生命周期。
// 实现 relaycommon.BillingSettler 接口。
type BillingSession struct {
	relayInfo        *relaycommon.RelayInfo
	funding          FundingSource
	preConsumedQuota int  // 实际预扣额度（信任用户可能为 0）
	tokenConsumed    int  // 令牌额度实际扣减量
	extraReserved    int  // 发送前补充预扣的额度（订阅退款时需要单独回滚）
	trusted          bool // 是否命中信任额度旁路
	fundingSettled   bool // funding.Settle 已成功，资金来源已提交
	settled          bool // Settle 全部完成（资金 + 令牌）
	refunded         bool // Refund 已调用
	mu               sync.Mutex
}

// Settle 根据实际消耗额度进行结算。
// 资金来源和令牌额度分两步提交：若资金来源已提交但令牌调整失败，
// 会标记 fundingSettled 防止 Refund 对已提交的资金来源执行退款。
func (s *BillingSession) Settle(actualQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settled {
		return nil
	}
	delta := actualQuota - s.preConsumedQuota
	if s.relayInfo.ForcePreConsume {
		if delta != 0 {
			operation, _, err := s.applyDurableOperation(s.operationInput(
				model.BillingOperationSettle,
				fmt.Sprintf("%s:settle:%d", s.operationKey(), actualQuota),
				delta,
				actualQuota,
			))
			if err != nil {
				return err
			}
			s.applyOperation(operation)
		}
		s.preConsumedQuota = actualQuota
		s.tokenConsumed = actualQuota
		s.settled = true
		s.syncRelayInfo()
		projectBillingOperationCaches(s.relayInfo.UserId, s.relayInfo.TokenId)
		return nil
	}
	if delta == 0 {
		s.settled = true
		return nil
	}
	// 1) 调整资金来源（仅在尚未提交时执行，防止重复调用）
	if !s.fundingSettled {
		if err := s.funding.Settle(delta); err != nil {
			return err
		}
		s.fundingSettled = true
	}
	// 2) 调整令牌额度
	var tokenErr error
	if !s.relayInfo.IsPlayground {
		if delta > 0 {
			tokenErr = model.DecreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, delta)
		} else {
			tokenErr = model.IncreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, -delta)
		}
		if tokenErr != nil {
			// 资金来源已提交，令牌调整失败只能记录日志；标记 settled 防止 Refund 误退资金
			common.SysLog(fmt.Sprintf("error adjusting token quota after funding settled (userId=%d, tokenId=%d, delta=%d): %s",
				s.relayInfo.UserId, s.relayInfo.TokenId, delta, tokenErr.Error()))
		}
	}
	// 3) 更新 relayInfo 上的订阅 PostDelta（用于日志）
	if s.funding.Source() == BillingSourceSubscription {
		s.relayInfo.SubscriptionPostDelta += int64(delta)
	}
	s.settled = true
	return tokenErr
}

// Refund 退还所有预扣费，幂等安全，异步执行。
func (s *BillingSession) Refund(c *gin.Context) {
	s.mu.Lock()
	if s.settled || s.refunded || !s.needsRefundLocked() {
		s.mu.Unlock()
		return
	}
	s.refunded = true
	s.mu.Unlock()
	if s.relayInfo.ForcePreConsume {
		operation, _, err := s.applyDurableOperation(s.operationInput(
			model.BillingOperationRefund,
			s.operationKey()+":refund",
			-s.preConsumedQuota,
			0,
		))
		if err != nil {
			common.SysLog("error applying atomic billing refund: " + err.Error())
			return
		}
		s.applyOperation(operation)
		projectBillingOperationCaches(s.relayInfo.UserId, s.relayInfo.TokenId)
		return
	}

	logger.LogInfo(c, fmt.Sprintf("用户 %d 请求失败, 返还预扣费（token_quota=%s, funding=%s）",
		s.relayInfo.UserId,
		logger.FormatQuota(s.tokenConsumed),
		s.funding.Source(),
	))

	// 复制需要的值到闭包中
	tokenId := s.relayInfo.TokenId
	tokenKey := s.relayInfo.TokenKey
	isPlayground := s.relayInfo.IsPlayground
	tokenConsumed := s.tokenConsumed
	extraReserved := s.extraReserved
	subscriptionId := s.relayInfo.SubscriptionId
	usageGeneration := s.relayInfo.SubscriptionUsageGeneration
	funding := s.funding

	gopool.Go(func() {
		// 1) 退还资金来源
		if err := funding.Refund(); err != nil {
			common.SysLog("error refunding billing source: " + err.Error())
		}
		if extraReserved > 0 && funding.Source() == BillingSourceSubscription && subscriptionId > 0 {
			if err := model.PostConsumeUserSubscriptionDelta(subscriptionId, usageGeneration, -int64(extraReserved)); err != nil {
				common.SysLog("error refunding subscription extra reserved quota: " + err.Error())
			}
		}
		// 2) 退还令牌额度
		if tokenConsumed > 0 && !isPlayground {
			if err := model.IncreaseTokenQuota(tokenId, tokenKey, tokenConsumed); err != nil {
				common.SysLog("error refunding token quota: " + err.Error())
			}
		}
	})
}

// NeedsRefund 返回是否存在需要退还的预扣状态。
func (s *BillingSession) NeedsRefund() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.needsRefundLocked()
}

func (s *BillingSession) needsRefundLocked() bool {
	if s.settled || s.refunded || s.fundingSettled {
		// fundingSettled 时资金来源已提交结算，不能再退预扣费
		return false
	}
	if s.tokenConsumed > 0 {
		return true
	}
	// 订阅可能在 tokenConsumed=0 时仍预扣了额度
	if sub, ok := s.funding.(*SubscriptionFunding); ok && sub.preConsumed > 0 {
		return true
	}
	return false
}

// GetPreConsumedQuota 返回实际预扣的额度。
func (s *BillingSession) GetPreConsumedQuota() int {
	return s.preConsumedQuota
}

func (s *BillingSession) Reserve(targetQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.settled || s.refunded || targetQuota <= s.preConsumedQuota {
		return nil
	}

	delta := targetQuota - s.preConsumedQuota
	if delta <= 0 {
		return nil
	}
	if s.relayInfo.ForcePreConsume {
		operation, _, err := s.applyDurableOperation(s.operationInput(
			model.BillingOperationReserve,
			fmt.Sprintf("%s:reserve:%d", s.operationKey(), targetQuota),
			delta,
			targetQuota,
		))
		if err != nil {
			return err
		}
		s.applyOperation(operation)
		s.preConsumedQuota = targetQuota
		s.tokenConsumed = targetQuota
		s.extraReserved += delta
		s.syncRelayInfo()
		projectBillingOperationCaches(s.relayInfo.UserId, s.relayInfo.TokenId)
		return nil
	}

	if err := s.reserveFunding(delta); err != nil {
		return err
	}
	if err := s.reserveToken(delta); err != nil {
		s.rollbackFundingReserve(delta)
		return err
	}

	s.preConsumedQuota += delta
	s.tokenConsumed += delta
	s.extraReserved += delta
	s.trusted = false
	s.syncRelayInfo()
	return nil
}

// ---------------------------------------------------------------------------
// PreConsume — 统一预扣费入口（含信任额度旁路）
// ---------------------------------------------------------------------------

// preConsume 执行预扣费：信任检查 -> 令牌预扣 -> 资金来源预扣。
// 任一步骤失败时原子回滚已完成的步骤。
func (s *BillingSession) preConsume(c *gin.Context, quota int) *types.NewAPIError {
	effectiveQuota := quota
	if s.relayInfo.ForcePreConsume {
		operation, _, err := s.applyDurableOperation(s.operationInput(
			model.BillingOperationInitial,
			s.operationKey()+":initial",
			effectiveQuota,
			effectiveQuota,
		))
		if err != nil {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		s.applyOperation(operation)
		s.preConsumedQuota = effectiveQuota
		s.tokenConsumed = effectiveQuota
		s.syncRelayInfo()
		projectBillingOperationCaches(s.relayInfo.UserId, s.relayInfo.TokenId)
		return nil
	}

	// ---- 信任额度旁路 ----
	if s.shouldTrust(c) {
		s.trusted = true
		effectiveQuota = 0
		logger.LogInfo(c, fmt.Sprintf("用户 %d 额度充足, 信任且不需要预扣费 (funding=%s)", s.relayInfo.UserId, s.funding.Source()))
	} else if effectiveQuota > 0 {
		logger.LogInfo(c, fmt.Sprintf("用户 %d 需要预扣费 %s (funding=%s)", s.relayInfo.UserId, logger.FormatQuota(effectiveQuota), s.funding.Source()))
	}

	// ---- 1) 预扣令牌额度 ----
	if effectiveQuota > 0 {
		if err := PreConsumeTokenQuota(s.relayInfo, effectiveQuota); err != nil {
			return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		s.tokenConsumed = effectiveQuota
	}

	// ---- 2) 预扣资金来源 ----
	if err := s.funding.PreConsume(effectiveQuota); err != nil {
		// 预扣费失败，回滚令牌额度
		if s.tokenConsumed > 0 && !s.relayInfo.IsPlayground {
			if rollbackErr := model.IncreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, s.tokenConsumed); rollbackErr != nil {
				common.SysLog(fmt.Sprintf("error rolling back token quota (userId=%d, tokenId=%d, amount=%d, fundingErr=%s): %s",
					s.relayInfo.UserId, s.relayInfo.TokenId, s.tokenConsumed, err.Error(), rollbackErr.Error()))
			}
			s.tokenConsumed = 0
		}
		// TODO: model 层应定义哨兵错误（如 ErrNoActiveSubscription），用 errors.Is 替代字符串匹配
		errMsg := err.Error()
		if strings.Contains(errMsg, "no active subscription") || strings.Contains(errMsg, "subscription quota insufficient") {
			return types.NewErrorWithStatusCode(fmt.Errorf("订阅额度不足或未配置订阅: %s", errMsg), types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}

	s.preConsumedQuota = effectiveQuota

	// ---- 同步 RelayInfo 兼容字段 ----
	s.syncRelayInfo()

	return nil
}

func (s *BillingSession) operationKey() string {
	if s.relayInfo.BillingOperationKey == "" {
		s.relayInfo.BillingOperationKey = s.relayInfo.RequestId
	}
	return "async:" + s.relayInfo.BillingOperationKey
}

func (s *BillingSession) operationInput(kind, key string, delta, charged int) model.BillingOperationInput {
	return model.BillingOperationInput{IdempotencyKey: key, Kind: kind, UserID: s.relayInfo.UserId,
		TokenID: s.relayInfo.TokenId, SubscriptionID: s.relayInfo.SubscriptionId,
		SubscriptionUsageGeneration: s.relayInfo.SubscriptionUsageGeneration,
		OverageSubscriptionID:       s.relayInfo.OverageSubscriptionId,
		OverageUsageGeneration:      s.relayInfo.OverageSubscriptionUsageGeneration,
		BillingSource:               s.funding.Source(), Delta: delta, ChargedQuota: charged, ReferenceKey: s.operationKey() + ":initial",
		SetChargeToTarget: kind != model.BillingOperationInitial}
}

func (s *BillingSession) applyDurableOperation(input model.BillingOperationInput) (*model.BillingOperation, bool, error) {
	if err := model.FlushBillingQuotaBatches(s.relayInfo.UserId, s.relayInfo.TokenId); err != nil {
		return nil, false, err
	}
	operation, applied, err := model.ApplyBillingOperation(input)
	if err != nil || !applied {
		return operation, applied, err
	}
	return operation, true, nil
}

func (s *BillingSession) applyOperation(operation *model.BillingOperation) {
	if operation == nil {
		return
	}
	if operation.SubscriptionID > 0 {
		s.relayInfo.SubscriptionId = operation.SubscriptionID
		s.relayInfo.SubscriptionUsageGeneration = operation.SubscriptionUsageGeneration
		if funding, ok := s.funding.(*SubscriptionFunding); ok {
			funding.subscriptionId = operation.SubscriptionID
			funding.usageGeneration = operation.SubscriptionUsageGeneration
			funding.preConsumed = int64(operation.ChargedQuota)
		}
	}
}

func projectBillingOperationCaches(userID, tokenID int) {
	for _, operation := range model.PendingBillingOperationProjections(100) {
		if operation.UserID != userID || operation.TokenID != tokenID {
			continue
		}
		if model.InvalidateUserCache(operation.UserID) != nil {
			continue
		}
		if operation.TokenID > 0 && model.InvalidateUserTokensCache(operation.UserID) != nil {
			continue
		}
		_ = model.CompleteBillingOperationProjection(operation.ID)
	}
}
func (s *BillingSession) reserveFunding(delta int) error {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if err := model.DecreaseUserQuota(funding.userId, delta, false); err != nil {
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		funding.consumed += delta
		funding.trackOverage(delta)
		return nil
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, funding.usageGeneration, int64(delta)); err != nil {
			return types.NewErrorWithStatusCode(
				fmt.Errorf("订阅额度不足或未配置订阅: %s", err.Error()),
				types.ErrorCodeInsufficientUserQuota,
				http.StatusForbidden,
				types.ErrOptionWithSkipRetry(),
				types.ErrOptionWithNoRecordErrorLog(),
			)
		}
		return nil
	default:
		return types.NewError(fmt.Errorf("unsupported funding source: %s", s.funding.Source()), types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}
}

func (s *BillingSession) rollbackFundingReserve(delta int) {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if err := model.IncreaseUserQuota(funding.userId, delta, false); err != nil {
			common.SysLog("error rolling back wallet funding reserve: " + err.Error())
		} else {
			funding.consumed -= delta
			funding.trackOverage(-delta)
		}
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, funding.usageGeneration, -int64(delta)); err != nil {
			common.SysLog("error rolling back subscription funding reserve: " + err.Error())
		}
	}
}

func (s *BillingSession) reserveToken(delta int) error {
	if delta <= 0 || s.relayInfo.IsPlayground {
		return nil
	}
	if err := PreConsumeTokenQuota(s.relayInfo, delta); err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	return nil
}

// shouldTrust 统一信任额度检查，适用于钱包和订阅。
func (s *BillingSession) shouldTrust(c *gin.Context) bool {
	// 异步任务（ForcePreConsume=true）必须预扣全额，不允许信任旁路
	if s.relayInfo.ForcePreConsume {
		return false
	}

	trustQuota := common.GetTrustQuota()
	if trustQuota <= 0 {
		return false
	}

	// 检查令牌是否充足
	tokenTrusted := s.relayInfo.TokenUnlimited
	if !tokenTrusted {
		tokenQuota := c.GetInt("token_quota")
		tokenTrusted = tokenQuota > trustQuota
	}
	if !tokenTrusted {
		return false
	}

	switch s.funding.Source() {
	case BillingSourceWallet:
		return s.relayInfo.UserQuota > trustQuota
	case BillingSourceSubscription:
		// 订阅不能启用信任旁路。原因：
		// 1. PreConsumeUserSubscription 要求 amount>0 来创建预扣记录并锁定订阅
		// 2. SubscriptionFunding.PreConsume 忽略参数，始终用 s.amount 预扣
		// 3. 若信任旁路将 effectiveQuota 设为 0，会导致 preConsumedQuota 与实际订阅预扣不一致
		return false
	default:
		return false
	}
}

// syncRelayInfo 将 BillingSession 的状态同步到 RelayInfo 的兼容字段上。
func (s *BillingSession) syncRelayInfo() {
	info := s.relayInfo
	info.FinalPreConsumedQuota = s.preConsumedQuota
	info.BillingSource = s.funding.Source()

	if sub, ok := s.funding.(*SubscriptionFunding); ok {
		info.SubscriptionId = sub.subscriptionId
		info.SubscriptionUsageGeneration = sub.usageGeneration
		info.SubscriptionPreConsumed = sub.preConsumed + int64(s.extraReserved)
		info.SubscriptionPostDelta = 0
		info.SubscriptionAmountTotal = sub.AmountTotal
		info.SubscriptionAmountUsedAfterPreConsume = sub.AmountUsedAfter + int64(s.extraReserved)
		info.SubscriptionPlanId = sub.PlanId
		info.SubscriptionPlanTitle = sub.PlanTitle
	} else {
		info.SubscriptionId = 0
		info.SubscriptionUsageGeneration = 0
		info.SubscriptionPreConsumed = 0
	}
	if wallet, ok := s.funding.(*WalletFunding); ok {
		info.OverageSubscriptionId = wallet.overageSubscriptionId
		info.OverageSubscriptionUsageGeneration = wallet.overageUsageGeneration
	} else {
		info.OverageSubscriptionId = 0
		info.OverageSubscriptionUsageGeneration = 0
	}
}

// ---------------------------------------------------------------------------
// NewBillingSession 工厂 — 根据计费偏好创建会话并处理回退
// ---------------------------------------------------------------------------

// NewBillingSession 创建计费会话。资金链固定为：
// 有订阅 → 订阅额度 → 额外用量（钱包余额，需用户开启且在每周期上限内）→ 拒绝；
// 无订阅 → 钱包余额（pay-as-you-go）。
func NewBillingSession(c *gin.Context, relayInfo *relaycommon.RelayInfo, preConsumedQuota int) (*BillingSession, *types.NewAPIError) {
	if relayInfo == nil {
		return nil, types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	// 钱包路径需要先检查用户额度。overageSubscriptionId > 0 时本次消费计入该订阅周期的额外用量。
	tryWallet := func(overageSubscriptionId int, overageUsageGeneration int64) (*BillingSession, *types.NewAPIError) {
		userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if userQuota <= 0 {
			return nil, types.NewErrorWithStatusCode(
				fmt.Errorf("用户额度不足, 剩余额度: %s", logger.FormatQuota(userQuota)),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		if userQuota-preConsumedQuota < 0 {
			return nil, types.NewErrorWithStatusCode(
				fmt.Errorf("预扣费额度失败, 用户剩余额度: %s, 需要预扣费额度: %s", logger.FormatQuota(userQuota), logger.FormatQuota(preConsumedQuota)),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		relayInfo.UserQuota = userQuota

		session := &BillingSession{
			relayInfo: relayInfo,
			funding: &WalletFunding{userId: relayInfo.UserId, overageSubscriptionId: overageSubscriptionId,
				overageUsageGeneration: overageUsageGeneration},
		}
		if apiErr := session.preConsume(c, preConsumedQuota); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	trySubscription := func() (*BillingSession, *types.NewAPIError) {
		subConsume := int64(preConsumedQuota)
		if subConsume <= 0 {
			subConsume = 1
		}
		session := &BillingSession{
			relayInfo: relayInfo,
			funding: &SubscriptionFunding{
				requestId: relayInfo.RequestId,
				userId:    relayInfo.UserId,
				modelName: relayInfo.OriginModelName,
				amount:    subConsume,
			},
		}
		// 必须传 subConsume 而非 preConsumedQuota，保证 SubscriptionFunding.amount、
		// preConsume 参数和 FinalPreConsumedQuota 三者一致，避免订阅多扣费。
		if apiErr := session.preConsume(c, int(subConsume)); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	hasSub, subCheckErr := model.HasActiveUserSubscription(relayInfo.UserId)
	if subCheckErr != nil {
		return nil, types.NewError(subCheckErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	if !hasSub {
		return tryWallet(0, 0)
	}

	session, apiErr := trySubscription()
	if apiErr == nil {
		return session, nil
	}
	if apiErr.GetErrorCode() != types.ErrorCodeInsufficientUserQuota {
		return nil, apiErr
	}

	// 订阅额度不足 → 额外用量回退。套餐必须允许（AllowWalletOverflow），
	// 用户必须显式开启，且不超过用户设定的每周期上限。
	allowOverflow, overflowErr := model.UserActiveSubscriptionsAllowWalletOverflow(relayInfo.UserId)
	if overflowErr != nil {
		return nil, types.NewError(overflowErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	if !allowOverflow {
		return nil, apiErr
	}
	if !relayInfo.UserSetting.OverageEnabled {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("订阅额度已用完。可在控制台钱包页开启\"额外用量\"后使用余额继续，或等待额度重置"),
			types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
			types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	primarySub, primaryErr := model.GetPrimaryActiveSubscriptionForOverage(relayInfo.UserId)
	if primaryErr != nil {
		return nil, types.NewError(primaryErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
	}
	overageSubscriptionId := 0
	var overageUsageGeneration int64
	if primarySub != nil {
		overageSubscriptionId = primarySub.Id
		overageUsageGeneration = primarySub.UsageGeneration
		if limitUsd := relayInfo.UserSetting.OverageLimitUsd; limitUsd > 0 {
			// 上限是软限额（并发请求可能轻微超出），只做阈值比较，不参与计费换算。
			limitQuota := decimal.NewFromFloat(limitUsd).
				Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
				IntPart()
			if primarySub.OverageUsed+int64(preConsumedQuota) > limitQuota {
				return nil, types.NewErrorWithStatusCode(
					fmt.Errorf("额外用量已达本周期上限，可在控制台钱包页调整上限或等待额度重置"),
					types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
					types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
			}
		}
	}
	session, apiErr = tryWallet(overageSubscriptionId, overageUsageGeneration)
	return session, apiErr
}
