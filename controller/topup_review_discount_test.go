package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTopUpReviewHTTPPreservesDiscountAndCreditSnapshots(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.TopUpSubmission{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "payer", AffCode: "payer-aff"}).Error)
	require.NoError(t, db.Create(&model.TopUp{
		UserId: 1, TradeNo: "REVIEW-SNAPSHOT", Amount: 400, Money: 65000,
		TopUpDiscountSnapshot: model.TopUpDiscountSnapshot{
			FaceAmount: 100000, PaidAmount: 65000, ActivityDiscount: 30000, CouponDiscount: 5000,
			CouponCode: "EXTRA5K", CouponID: 3, CreditUSD: 4, ExpiresAt: 1900000000, SubmissionStatus: "submitted",
		},
	}).Error)
	require.NoError(t, db.Create(&model.TopUpSubmission{Id: 1, UserId: 1, TradeNo: "REVIEW-SNAPSHOT", OrderType: "balance", Status: "submitted"}).Error)
	router := gin.New()
	router.GET("/reviews", ListTopUpReviews)
	router.GET("/reviews/:id", GetTopUpReview)
	for _, path := range []string{"/reviews?status=submitted", "/reviews/1"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
			require.Equal(t, http.StatusOK, w.Code)
			var response struct {
				Success bool           `json:"success"`
				Data    map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
			require.True(t, response.Success)
			data := response.Data
			if items, ok := data["items"].([]any); ok {
				require.Len(t, items, 1)
				data = items[0].(map[string]any)
			}
			assert.EqualValues(t, 400, data["amount"], "legacy credit units must not become VND payment units")
			assert.EqualValues(t, 65000, data["money"])
			assert.EqualValues(t, 65000, data["paid_amount"])
			assert.EqualValues(t, 100000, data["face_amount"])
			assert.EqualValues(t, 30000, data["activity_discount"])
			assert.EqualValues(t, 5000, data["coupon_discount"])
			assert.Equal(t, "EXTRA5K", data["coupon_code"])
			assert.EqualValues(t, 4, data["credit_usd"])
			assert.EqualValues(t, 1900000000, data["expires_at"])
			assert.Equal(t, "submitted", data["submission_status"])
			assert.NotContains(t, data, "coupon_id")
		})
	}
}

func TestTopUpProofExpiredOrderReturnsActionableError(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.TopUpPromotion{}))
	oldDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB })
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "payer", AffCode: "payer-aff"}).Error)
	require.NoError(t, db.Create(&model.TopUp{
		UserId: 1, TradeNo: "EXPIRED", Status: common.TopUpStatusPending,
		PaymentMethod: model.PaymentMethodBankQR, PaymentProvider: model.PaymentProviderBankQR,
		TopUpDiscountSnapshot: model.TopUpDiscountSnapshot{ExpiresAt: common.GetTimestamp() - 1},
	}).Error)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	require.NoError(t, form.WriteField("bank_transaction_no", "BANK-EXPIRED"))
	require.NoError(t, form.Close())
	router := gin.New()
	router.POST("/topup/:trade_no/submissions", func(c *gin.Context) { c.Set("id", 1); c.Next() }, SubmitTopUpProof)
	req := httptest.NewRequest(http.MethodPost, "/topup/EXPIRED/submissions", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var response map[string]any
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
	assert.Equal(t, false, response["success"])
	assert.Equal(t, "topup_order_expired", response["code"])
}
