package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting"
	"github.com/gin-gonic/gin"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/checkout/session"
	stripesubscription "github.com/stripe/stripe-go/v81/subscription"
	"github.com/thanhpk/randstr"
)

type SubscriptionStripePayRequest struct {
	PlanId int `json:"plan_id"`
}

func SubscriptionRequestStripePay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req SubscriptionStripePayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.StripePriceId == "" {
		common.ApiErrorMsg(c, "该套餐未配置 StripePriceId")
		return
	}
	if !strings.HasPrefix(setting.StripeApiSecret, "sk_") && !strings.HasPrefix(setting.StripeApiSecret, "rk_") {
		common.ApiErrorMsg(c, "Stripe 未配置或密钥无效")
		return
	}
	if setting.StripeWebhookSecret == "" {
		common.ApiErrorMsg(c, "Stripe Webhook 未配置")
		return
	}

	userId := c.GetInt("id")
	user, err := model.GetUserById(userId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if user == nil {
		common.ApiErrorMsg(c, "用户不存在")
		return
	}

	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, i18n.T(c, i18n.MsgSubscriptionPurchaseMax))
			return
		}
	}

	reference := fmt.Sprintf("sub-stripe-ref-%d-%d-%s", user.Id, time.Now().UnixMilli(), randstr.String(4))
	referenceId := "sub_ref_" + common.Sha1([]byte(reference))

	payLink, err := genStripeSubscriptionLink(referenceId, user.StripeCustomer, user.Email, plan.StripePriceId)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Stripe 订阅支付链接创建失败 trade_no=%s plan_id=%d error=%q", referenceId, plan.Id, err.Error()))
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "拉起支付失败"})
		return
	}

	order := &model.SubscriptionOrder{
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           plan.PriceAmount,
		TradeNo:         referenceId,
		PaymentMethod:   model.PaymentMethodStripe,
		PaymentProvider: model.PaymentProviderStripe,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"data": gin.H{
			"pay_link": payLink,
		},
	})
}

type SubscriptionRenewalRequest struct {
	UserSubscriptionId int  `json:"user_subscription_id"`
	AutoRenew          bool `json:"auto_renew"`
}

// SubscriptionUpdateRenewal lets the owner cancel (at period end) or resume the
// provider-side auto renewal of a recurring subscription.
func SubscriptionUpdateRenewal(c *gin.Context) {
	userId := c.GetInt("id")
	var req SubscriptionRenewalRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserSubscriptionId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	sub, err := model.GetUserSubscriptionById(req.UserSubscriptionId)
	if err != nil || sub == nil || sub.UserId != userId {
		common.ApiErrorMsg(c, "订阅不存在")
		return
	}
	if sub.ProviderSubscriptionId == "" {
		common.ApiErrorMsg(c, "该订阅为一次性购买，无自动续费")
		return
	}
	if !strings.HasPrefix(setting.StripeApiSecret, "sk_") && !strings.HasPrefix(setting.StripeApiSecret, "rk_") {
		common.ApiErrorMsg(c, "Stripe 未配置或密钥无效")
		return
	}

	stripe.Key = setting.StripeApiSecret
	_, err = stripesubscription.Update(sub.ProviderSubscriptionId, &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(!req.AutoRenew),
	})
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Stripe 更新订阅续费状态失败 subscription=%s auto_renew=%t error=%q", sub.ProviderSubscriptionId, req.AutoRenew, err.Error()))
		common.ApiErrorMsg(c, "更新自动续费状态失败")
		return
	}
	if _, err := model.SetAutoRenewByProviderSubscriptionId(sub.ProviderSubscriptionId, req.AutoRenew); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"auto_renew": req.AutoRenew})
}

func genStripeSubscriptionLink(referenceId string, customerId string, email string, priceId string) (string, error) {
	stripe.Key = setting.StripeApiSecret

	params := &stripe.CheckoutSessionParams{
		ClientReferenceID: stripe.String(referenceId),
		SuccessURL:        stripe.String(paymentReturnPath("/wallet")),
		CancelURL:         stripe.String(paymentReturnPath("/wallet")),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(priceId),
				Quantity: stripe.Int64(1),
			},
		},
		Mode: stripe.String(string(stripe.CheckoutSessionModeSubscription)),
	}

	if "" == customerId {
		if "" != email {
			params.CustomerEmail = stripe.String(email)
		}
		params.CustomerCreation = stripe.String(string(stripe.CheckoutSessionCustomerCreationAlways))
	} else {
		params.Customer = stripe.String(customerId)
	}

	result, err := session.New(params)
	if err != nil {
		return "", err
	}
	return result.URL, nil
}
