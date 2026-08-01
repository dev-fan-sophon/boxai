package controller

import (
	"errors"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ValidateInternalSession resolves a browser session cookie forwarded by a
// sibling service (boxai-chat) into the authenticated user. The service
// forwards the user's Cookie header verbatim; the global session middleware
// has already parsed it by the time this handler runs.
func ValidateInternalSession(c *gin.Context) {
	session := sessions.Default(c)
	id, ok := session.Get("id").(int)
	if !ok || id == 0 {
		common.ApiErrorMsg(c, "no authenticated session")
		return
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorMsg(c, "session user not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorMsg(c, "user is banned")
		return
	}
	common.ApiSuccess(c, gin.H{
		"id":       user.Id,
		"username": user.Username,
		"role":     user.Role,
		"group":    user.Group,
	})
}
