package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type bankQRDiscountRequest struct {
	Amount     decimal.Decimal `json:"amount"`
	CouponCode string          `json:"coupon_code"`
}

func topUpDiscountError(c *gin.Context, err error) {
	code := "topup_discount_failed"
	message := "Unable to process top-up discount"
	switch {
	case errors.Is(err, model.ErrTopUpDiscountInvalid):
		code = "topup_discount_invalid"
		message = err.Error()
	case errors.Is(err, model.ErrTopUpCouponUnavailable):
		code = "topup_coupon_unavailable"
		message = err.Error()
	case errors.Is(err, model.ErrTopUpDiscountNonPositive):
		code = "topup_discount_non_positive"
		message = err.Error()
	case errors.Is(err, model.ErrBankQROrderExpired):
		code = "topup_order_expired"
		message = err.Error()
	case errors.Is(err, model.ErrTopUpSubmissionActive):
		code = "topup_submission_active"
		message = err.Error()
	case errors.Is(err, model.ErrBankQROrderNotPending), errors.Is(err, model.ErrBankQROrderNotFound), errors.Is(err, model.ErrBankQRPendingOrderLimit):
		code = "topup_order_unavailable"
		message = err.Error()
	}
	c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": message, "code": code})
}

func GetTopUpPromotion(c *gin.Context) {
	p, err := model.GetTopUpPromotion()
	if err != nil {
		topUpDiscountError(c, err)
		return
	}
	common.ApiSuccess(c, p)
}

func UpdateTopUpPromotion(c *gin.Context) {
	var p model.TopUpPromotion
	if c.ShouldBindJSON(&p) != nil {
		topUpDiscountError(c, model.ErrTopUpDiscountInvalid)
		return
	}
	if err := model.SaveTopUpPromotion(&p); err != nil {
		topUpDiscountError(c, err)
		return
	}
	common.ApiSuccess(c, p)
}

func ListTopUpCoupons(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pagesize", "20"))
	if page < 1 || page > 1_000_000 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	items, total, err := model.ListTopUpCoupons(size, (page-1)*size)
	if err != nil {
		topUpDiscountError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total})
}

func SaveTopUpCoupon(c *gin.Context) {
	var coupon model.TopUpCoupon
	if c.ShouldBindJSON(&coupon) != nil {
		topUpDiscountError(c, model.ErrTopUpDiscountInvalid)
		return
	}
	create := c.Request.Method == http.MethodPost
	if !create {
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil || id <= 0 {
			topUpDiscountError(c, model.ErrTopUpDiscountInvalid)
			return
		}
		coupon.ID = id
	}
	if err := model.SaveTopUpCoupon(&coupon, create); err != nil {
		topUpDiscountError(c, err)
		return
	}
	common.ApiSuccess(c, coupon)
}

func CancelBankQRTopUp(c *gin.Context) {
	if err := model.CancelBankQRTopUp(c.GetInt("id"), c.Param("trade_no")); err != nil {
		topUpDiscountError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
