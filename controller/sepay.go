package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func sePayCheckoutSnapshot(account string) (model.SePaySnapshot, error) {
	if os.Getenv("SEPAY_WEBHOOK_SECRET") == "" {
		return model.SePaySnapshot{}, nil
	}
	gateway := strings.TrimSpace(os.Getenv("SEPAY_BANK_GATEWAY"))
	if gateway == "" {
		return model.SePaySnapshot{}, errors.New("SePay bank gateway is not configured")
	}
	return model.SePaySnapshot{AutomaticConfirmation: true, SePayGateway: gateway, SePayAccount: account, SePaySubAccount: strings.TrimSpace(os.Getenv("SEPAY_SUB_ACCOUNT"))}, nil
}

func SePayWebhook(c *gin.Context) {
	secret := os.Getenv("SEPAY_WEBHOOK_SECRET")
	ts := c.GetHeader("X-SePay-Timestamp")
	timestamp, err := strconv.ParseInt(ts, 10, 64)
	now := time.Now().Unix()
	if secret == "" || err != nil || timestamp < now-300 || timestamp > now+300 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024))
	if err != nil {
		c.AbortWithStatus(http.StatusRequestEntityTooLarge)
		return
	}
	signature := c.GetHeader("X-SePay-Signature")
	decoded, err := hex.DecodeString(strings.TrimPrefix(signature, "sha256="))
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(ts + "."))
	_, _ = mac.Write(body)
	if !strings.HasPrefix(signature, "sha256=") || err != nil || !hmac.Equal(decoded, mac.Sum(nil)) {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	var transfer model.SePayTransfer
	if common.Unmarshal(body, &transfer) != nil || transfer.ID <= 0 {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	if err := model.ProcessSePayTransfer(transfer); err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func BankQRPaymentStatus(c *gin.Context) {
	status, err := model.GetBankQROrderStatus(c.GetInt("id"), c.Param("trade_no"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	common.ApiSuccess(c, status)
}
