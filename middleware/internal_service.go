package middleware

import (
	"crypto/subtle"
	"net/http"
	"strconv"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"

	"github.com/gin-gonic/gin"
)

// Internal service authentication lets trusted sibling services (boxai-chat)
// call gateway endpoints on behalf of a user, reusing the exact billing and
// quota context a browser session would produce. The boundary is the shared
// secret: the act-as header does nothing without it, and the secret never
// leaves the host (both services bind to 127.0.0.1 behind nginx).

const (
	internalServiceSecretEnv = "INTERNAL_SERVICE_SECRET"
	internalActAsUserHeader  = "X-BoxAI-Act-As-User"
	internalServiceHeader    = "X-BoxAI-Internal-Secret"
)

func internalServiceSecret() string {
	return common.GetEnvOrDefaultString(internalServiceSecretEnv, "")
}

// isInternalServiceRequest reports whether the request presents the internal
// secret header at all; callers decide how to fail on mismatch.
func isInternalServiceRequest(c *gin.Context) bool {
	return c.Request.Header.Get(internalServiceHeader) != ""
}

// verifyInternalSecret checks the shared secret alone. Returns false after
// writing the error response when the secret is absent, wrong, or the feature
// is disabled (no secret configured).
func verifyInternalSecret(c *gin.Context) bool {
	secret := internalServiceSecret()
	presented := c.Request.Header.Get(internalServiceHeader)
	if secret == "" ||
		subtle.ConstantTimeCompare([]byte(secret), []byte(presented)) != 1 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "invalid internal service credentials",
		})
		c.Abort()
		return false
	}
	return true
}

// authenticateInternalService validates the shared secret and loads the
// acted-as user into the same context keys authHelper sets, so downstream
// relay/billing handlers cannot tell the difference. Returns false after
// writing the error response when authentication fails.
func authenticateInternalService(c *gin.Context) bool {
	if !verifyInternalSecret(c) {
		return false
	}
	userId, err := strconv.Atoi(c.Request.Header.Get(internalActAsUserHeader))
	if err != nil || userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "invalid act-as user",
		})
		c.Abort()
		return false
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "act-as user not found",
		})
		c.Abort()
		return false
	}
	if user.Status != common.UserStatusEnabled {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "act-as user is banned",
		})
		c.Abort()
		return false
	}
	c.Set("username", user.Username)
	c.Set("role", user.Role)
	c.Set("id", user.Id)
	c.Set("group", user.Group)
	c.Set("user_group", user.Group)
	c.Set("use_access_token", false)
	c.Set("internal_service", true)
	return true
}

// InternalServiceAuth guards gateway-internal endpoints that only sibling
// services may call.
func InternalServiceAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if authenticateInternalService(c) {
			c.Next()
		}
	}
}

// RequireInternalService rejects requests whose auth context was not produced
// by the internal service path. Used on routes registered inside mixed-auth
// groups (e.g. /pg) that must never be reachable by a browser session.
func RequireInternalService() func(c *gin.Context) {
	return func(c *gin.Context) {
		if !c.GetBool("internal_service") {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "not found"})
			c.Abort()
		}
	}
}

// InternalServiceSecretAuth guards internal endpoints that run before a user
// is known, e.g. resolving a forwarded browser session into a user.
func InternalServiceSecretAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if verifyInternalSecret(c) {
			c.Next()
		}
	}
}

// UserOrInternalServiceAuth accepts either a normal authenticated user or a
// trusted sibling service acting on a user's behalf. Mounted on the /pg relay
// group so boxai-chat bills model calls to the acted-as user through the
// existing pipeline.
func UserOrInternalServiceAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if isInternalServiceRequest(c) {
			if authenticateInternalService(c) {
				c.Next()
			}
			return
		}
		authHelper(c, common.RoleCommonUser)
	}
}
