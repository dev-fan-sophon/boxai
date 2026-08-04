package controller

import (
	"fmt"
	"net"
	"strings"
	"unicode/utf8"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
)

const (
	docsFeedbackPathMaxRunes    = 200
	docsFeedbackCommentMaxRunes = 500
)

type docsFeedbackRequest struct {
	Path    string `json:"path"`
	Helpful *bool  `json:"helpful"`
	Comment string `json:"comment"`
	Locale  string `json:"locale"`
}

// SubmitDocsFeedback records lightweight public docs helpfulness feedback.
// No database write: logs are enough for P1 content iteration without schema churn.
func SubmitDocsFeedback(c *gin.Context) {
	var req docsFeedbackRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "invalid request body")
		return
	}
	if req.Helpful == nil {
		common.ApiErrorMsg(c, "helpful is required")
		return
	}

	path := strings.TrimSpace(req.Path)
	path = strings.Trim(path, "/")
	if path == "" || utf8.RuneCountInString(path) > docsFeedbackPathMaxRunes {
		common.ApiErrorMsg(c, "invalid path")
		return
	}
	if strings.Contains(path, "..") || strings.ContainsAny(path, " \t\r\n") {
		common.ApiErrorMsg(c, "invalid path")
		return
	}
	// Normalize stored path to always look like docs/...
	if path != "docs" && !strings.HasPrefix(path, "docs/") {
		path = "docs/" + path
	}

	comment := strings.TrimSpace(req.Comment)
	if utf8.RuneCountInString(comment) > docsFeedbackCommentMaxRunes {
		common.ApiErrorMsg(c, "comment too long")
		return
	}
	// Strip control characters from free text.
	comment = strings.Map(func(r rune) rune {
		if r < 32 && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, comment)

	locale := strings.TrimSpace(req.Locale)
	if utf8.RuneCountInString(locale) > 16 {
		locale = locale[:16]
	}

	helpful := "no"
	if *req.Helpful {
		helpful = "yes"
	}

	userID := c.GetInt("id")
	clientIP := c.ClientIP()
	if host, _, err := net.SplitHostPort(clientIP); err == nil {
		clientIP = host
	}

	common.SysLog(fmt.Sprintf(
		"docs_feedback path=%q helpful=%s locale=%q user_id=%d ip=%s comment=%q",
		path,
		helpful,
		locale,
		userID,
		clientIP,
		comment,
	))

	common.ApiSuccess(c, gin.H{"ok": true})
}
