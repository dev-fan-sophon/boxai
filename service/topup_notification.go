package service

import (
	"context"
	"errors"
	"fmt"
	"html"
	"slices"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
)

type topUpNotificationHandler struct{}

func init() { RegisterSystemTaskHandler(topUpNotificationHandler{}) }

func (topUpNotificationHandler) Type() string { return "topup_review_email" }
func (topUpNotificationHandler) Enabled() bool {
	if !operation_setting.GetTopUpReviewNotificationSetting().Enabled {
		return false
	}
	items, err := model.DueTopUpReviewNotifications(common.GetTimestamp(), 1)
	if err != nil {
		common.SysError("failed to query top-up email queue: " + err.Error())
	}
	return len(items) > 0
}
func (topUpNotificationHandler) Interval() time.Duration { return 15 * time.Second }
func (topUpNotificationHandler) NewPayload() any         { return nil }
func (topUpNotificationHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	err := deliverTopUpReviewNotifications(ctx, common.SendEmail)
	if err != nil {
		failSystemTask(task, runnerID, err)
		return
	}
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, nil, ""); err != nil {
		logSystemTaskLockError(ctx, task, err)
	}
}

func deliverTopUpReviewNotifications(ctx context.Context, send func(string, string, string) error) error {
	items, err := model.DueTopUpReviewNotifications(common.GetTimestamp(), 10)
	if err != nil {
		return err
	}
	var deliveryErrors []error
	for i := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		setting := operation_setting.GetTopUpReviewNotificationSetting()
		if !setting.Enabled {
			break
		}
		item := &items[i]
		claimed, err := model.ClaimTopUpReviewNotification(item, common.GetTimestamp())
		if err != nil {
			return err
		}
		if !claimed {
			continue
		}
		status := "skipped"
		var submission model.TopUpSubmission
		err = model.DB.First(&submission, item.SubmissionId).Error
		if err == nil && submission.Status == model.TopUpSubmissionSubmitted && slices.Contains(setting.Recipients, item.Recipient) {
			var content string
			content, err = topUpReviewEmailContent(&submission)
			if err == nil {
				err = send("BoxAI — Nạp tiền chờ duyệt / Top-up awaiting review", item.Recipient, content)
			}
			status = "sent"
		}
		if err != nil {
			status = "pending"
			// SMTP errors may contain addresses or credentials; record IDs only.
			logger.LogWarn(ctx, fmt.Sprintf("top-up review email %d failed; automatic retry scheduled", item.Id))
			deliveryErrors = append(deliveryErrors, fmt.Errorf("top-up review email %d failed", item.Id))
		}
		if err := model.FinishTopUpReviewNotification(item, common.GetTimestamp(), status); err != nil {
			return err
		}
	}
	return errors.Join(deliveryErrors...)
}

func topUpReviewEmailContent(submission *model.TopUpSubmission) (string, error) {
	var paid float64
	var face int64
	if submission.OrderType == model.TopUpSubmissionOrderBalance {
		var order model.TopUp
		if err := model.DB.Where("trade_no = ?", submission.TradeNo).First(&order).Error; err != nil {
			return "", err
		}
		paid, face = order.Money, order.FaceAmountMinor
	} else {
		var order model.SubscriptionOrder
		if err := model.DB.Where("trade_no = ?", submission.TradeNo).First(&order).Error; err != nil {
			return "", err
		}
		var payload model.BankQRSubscriptionOrderPayload
		if err := common.UnmarshalJsonStr(order.ProviderPayload, &payload); err != nil {
			return "", err
		}
		paid = float64(payload.Amount)
	}
	url := strings.TrimRight(system_setting.ServerAddress, "/") + "/pricing-center/topup-reviews"
	return fmt.Sprintf(`<h2>Yêu cầu nạp tiền đang chờ duyệt / Top-up awaiting review</h2>
<p>Người dùng / User ID: %d</p><p>Mã đơn / Order: %s</p>
<p>Mệnh giá / Face amount: %d VND</p><p>Số tiền cần chuyển / Expected transfer: %.0f VND</p>
<p>Mã giao dịch / Bank reference: %s</p>
<p><a href="%s">Kiểm tra và duyệt / Review payment</a></p>
<p>Vui lòng xác minh tiền đã vào tài khoản trước khi duyệt. Người dùng bấm “Đã thanh toán” không xác nhận tiền đã nhận.<br>Verify the bank receipt before approving. A user payment claim is not proof of receipt.</p>`,
		submission.UserId, html.EscapeString(submission.TradeNo), face, paid,
		html.EscapeString(submission.BankTransactionNo), html.EscapeString(url)), nil
}
