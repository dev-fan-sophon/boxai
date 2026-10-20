package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SePayWebhook(c *gin.Context) {
	secret := operation_setting.GetSePaySetting().WebhookSecret
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
	if common.Unmarshal(body, &transfer) != nil || transfer.ID <= 0 || transfer.Gateway == "" || transfer.AccountNumber == "" || transfer.TransferAmount == "" || (transfer.TransferType != "in" && transfer.TransferType != "out") {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	if err := model.ProcessSePayTransfer(transfer); err != nil {
		common.SysError("SePay settlement failed for transaction " + strconv.FormatInt(transfer.ID, 10))
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
