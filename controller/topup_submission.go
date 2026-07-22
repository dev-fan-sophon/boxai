package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func SubmitTopUpProof(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.TopUpProofMaxBytes+1024*1024)
	userID, tradeNo := c.GetInt("id"), strings.TrimSpace(c.Param("trade_no"))
	bankNo, note := strings.TrimSpace(c.PostForm("bank_transaction_no")), strings.TrimSpace(c.PostForm("note"))
	if len(bankNo) > 128 || len(note) > 1000 {
		common.ApiErrorMsg(c, "bank transaction number or note is too long")
		return
	}
	var key, backend, mimeType string
	var size int64
	file, err := c.FormFile("file")
	if err == nil {
		if file.Size > service.TopUpProofMaxBytes {
			common.ApiErrorMsg(c, "proof must be at most 10MB")
			return
		}
		f, openErr := file.Open()
		if openErr != nil {
			common.ApiError(c, openErr)
			return
		}
		defer f.Close()
		data, readErr := io.ReadAll(io.LimitReader(f, service.TopUpProofMaxBytes+1))
		if readErr != nil {
			common.ApiError(c, readErr)
			return
		}
		key, backend, mimeType, err = service.SaveTopUpProof(c.Request.Context(), userID, data)
		if err != nil {
			common.ApiErrorMsg(c, err.Error())
			return
		}
		size = int64(len(data))
	} else if !errors.Is(err, http.ErrMissingFile) {
		common.ApiError(c, err)
		return
	}
	if bankNo == "" && key == "" {
		common.ApiErrorMsg(c, "bank_transaction_no or file is required")
		return
	}
	item := &model.TopUpSubmission{UserId: userID, TradeNo: tradeNo, BankTransactionNo: bankNo, Note: note, ProofStorageKey: key, ProofBackend: backend, ProofMime: mimeType, ProofSize: size}
	if err := model.CreateTopUpSubmission(item); err != nil {
		if deleteErr := service.DeleteTopUpProof(c.Request.Context(), key); deleteErr != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("failed to delete orphaned top-up proof key=%q: %v", key, deleteErr))
		}
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, submissionDTO(item, false))
}

func submissionDTO(item *model.TopUpSubmission, admin bool) gin.H {
	b := gin.H{"id": item.Id, "user_id": item.UserId, "trade_no": item.TradeNo, "order_type": item.OrderType, "bank_transaction_no": item.BankTransactionNo, "proof_mime": item.ProofMime, "proof_size": item.ProofSize, "note": item.Note, "status": item.Status, "submitted_at": item.SubmittedAt, "reviewed_at": item.ReviewedAt, "review_note": item.ReviewNote}
	if admin {
		b["proof_backend"] = item.ProofBackend
		b["reviewed_by"] = item.ReviewedBy
	}
	if item.ProofStorageKey != "" {
		if admin {
			b["proof_url"] = fmt.Sprintf("/api/user/topup/reviews/%d/proof", item.Id)
		} else {
			b["proof_url"] = fmt.Sprintf("/api/user/topup/submissions/%d/proof", item.Id)
		}
	}
	return b
}

func ListUserTopUpSubmissions(c *gin.Context) {
	items, err := model.GetUserTopUpSubmissions(c.Param("trade_no"), c.GetInt("id"))
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	result := make([]gin.H, 0, len(items))
	for i := range items {
		result = append(result, submissionDTO(&items[i], false))
	}
	common.ApiSuccess(c, result)
}

func GetUserTopUpProof(c *gin.Context)  { serveTopUpProof(c, false) }
func GetAdminTopUpProof(c *gin.Context) { serveTopUpProof(c, true) }
func serveTopUpProof(c *gin.Context, admin bool) {
	id, _ := strconv.Atoi(c.Param("id"))
	item, err := model.GetTopUpSubmission(id)
	if err != nil || (!admin && item.UserId != c.GetInt("id")) || item.ProofStorageKey == "" {
		c.Status(http.StatusNotFound)
		return
	}
	url, body, err := service.OpenTopUpProof(c.Request.Context(), item.ProofStorageKey)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	if url != "" {
		c.Redirect(http.StatusFound, url)
		return
	}
	defer body.Close()
	c.Header("Content-Type", item.ProofMime)
	c.Header("Content-Disposition", "inline")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Status(http.StatusOK)
	_, _ = io.Copy(c.Writer, body)
}

func ListTopUpReviews(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	items, total, err := model.ListTopUpReviews(strings.TrimSpace(c.Query("status")), strings.TrimSpace(c.Query("keyword")), size, (page-1)*size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]gin.H, 0, len(items))
	for i := range items {
		d := submissionDTO(&items[i].TopUpSubmission, true)
		d["username"], d["amount"], d["money"], d["currency"], d["plan_id"], d["plan_title"] = items[i].Username, items[i].Amount, items[i].Money, items[i].Currency, items[i].PlanId, items[i].PlanTitle
		result = append(result, d)
	}
	common.ApiSuccess(c, gin.H{"items": result, "total": total, "page": page, "page_size": size})
}

func GetTopUpReview(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "invalid review id")
		return
	}
	item, err := model.GetTopUpSubmission(id)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, submissionDTO(item, true))
}
func ApproveTopUpReview(c *gin.Context) { reviewTopUp(c, true, "") }
func RejectTopUpReview(c *gin.Context) {
	var req struct {
		Reason string `json:"reason"`
	}
	if c.ShouldBindJSON(&req) != nil || strings.TrimSpace(req.Reason) == "" {
		common.ApiErrorMsg(c, "reason is required")
		return
	}
	if len(strings.TrimSpace(req.Reason)) > 1000 {
		common.ApiErrorMsg(c, "reason is too long")
		return
	}
	reviewTopUp(c, false, strings.TrimSpace(req.Reason))
}
func reviewTopUp(c *gin.Context, approve bool, reason string) {
	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "invalid review id")
		return
	}
	before, err := model.GetTopUpSubmission(id)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	LockOrder(before.TradeNo)
	defer UnlockOrder(before.TradeNo)
	before, err = model.GetTopUpSubmission(id)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if approve && before.Status == model.TopUpSubmissionApproved {
		common.ApiSuccess(c, submissionDTO(before, true))
		return
	}
	item, err := model.ReviewTopUpSubmission(id, c.GetInt("id"), approve, reason)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	action := "topup.submission_reject"
	if approve {
		action = "topup.submission_approve"
	}
	recordManageAuditFor(c, item.UserId, action, map[string]interface{}{"submission_id": item.Id, "trade_no": item.TradeNo, "order_type": item.OrderType, "target_user_id": item.UserId, "bank_transaction_no": item.BankTransactionNo, "reason": reason})
	model.RecordLog(item.UserId, model.LogTypeManage, fmt.Sprintf("Bank QR review %s for %s order %s by administrator %d", item.Status, item.OrderType, item.TradeNo, c.GetInt("id")))
	common.ApiSuccess(c, submissionDTO(item, true))
}
