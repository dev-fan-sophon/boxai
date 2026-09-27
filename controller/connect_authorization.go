package controller

import (
	"net/http"
	"net/url"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
)

func StartConnectAuthorization(c *gin.Context) {
	method := c.DefaultQuery("code_challenge_method", "S256")
	a, err := service.CreateConnectAuthorization(c.Query("redirect_uri"), c.Query("code_challenge"), method, c.Query("state"), c.Query("client_name"))
	if err != nil {
		desktopOAuthError(c, 400, "invalid_request", "invalid authorization request")
		return
	}
	desktopNoStore(c)
	c.Redirect(http.StatusFound, "/connect/authorize?request="+url.QueryEscape(a.ID))
}

func GetConnectAuthorization(c *gin.Context) {
	a, err := service.GetConnectAuthorization(c.Param("id"))
	if err != nil {
		desktopOAuthError(c, 404, "invalid_request", "authorization request not found")
		return
	}
	desktopNoStore(c)
	c.JSON(200, gin.H{"id": a.ID, "client_id": "boxai-connect", "client_name": a.ClientName, "redirect_uri": a.RedirectURI, "status": a.Status, "expires_at": a.ExpiresAt})
}

func DecideConnectAuthorization(c *gin.Context) {
	var request struct {
		Approve *bool `json:"approve"`
	}
	if c.ShouldBindJSON(&request) != nil || request.Approve == nil {
		desktopOAuthError(c, 400, "invalid_request", "approve is required")
		return
	}
	code, a, err := service.DecideConnectAuthorization(c.Param("id"), c.GetInt("id"), *request.Approve)
	if err != nil {
		desktopOAuthError(c, 409, "invalid_request", "request already decided or expired")
		return
	}
	u, _ := url.Parse(a.RedirectURI)
	q := u.Query()
	q.Set("state", a.State)
	if *request.Approve {
		q.Set("code", code)
	} else {
		q.Set("error", "access_denied")
	}
	u.RawQuery = q.Encode()
	desktopNoStore(c)
	c.JSON(200, gin.H{"status": a.Status, "redirect_uri": u.String()})
}

func ExchangeConnectToken(c *gin.Context) {
	var request struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"code_verifier"`
		RedirectURI  string `json:"redirect_uri"`
	}
	if c.ShouldBindJSON(&request) != nil {
		desktopOAuthError(c, 400, "invalid_request", "invalid JSON")
		return
	}
	key, err := service.ExchangeConnectCode(request.Code, request.CodeVerifier, request.RedirectURI)
	if err != nil {
		desktopOAuthError(c, 400, "invalid_grant", "code is invalid or expired")
		return
	}
	desktopNoStore(c)
	c.JSON(200, gin.H{"access_token": key, "token_type": "Bearer", "base_url": publicOrigin(c) + "/v1"})
}

// GetAccountUsage is available to ordinary API keys, without a device session.
func GetAccountUsage(c *gin.Context) {
	desktopNoStore(c)
	user, rows, err := model.GetProvisioningAccountSnapshot(c.GetInt("id"))
	if err != nil {
		c.JSON(500, gin.H{"success": false, "message": "get account failed"})
		return
	}
	subscriptions := make([]connectorSubscription, 0, len(rows))
	walletFallback := true
	for _, sub := range rows {
		subscriptions = append(subscriptions, connectorSubscription{ID: sub.ID, PlanID: sub.PlanID, Status: sub.Status, Unlimited: sub.Unlimited, QuotaTotal: sub.QuotaTotal, QuotaUsed: sub.QuotaUsed, CurrentPeriodStart: sub.CurrentPeriodStart, EndTime: sub.EndTime, NextResetTime: sub.NextResetTime, WalletFallback: sub.WalletFallback})
		walletFallback = walletFallback && sub.WalletFallback
	}
	c.JSON(200, gin.H{"success": true, "data": gin.H{
		"account": connectorAccount{ID: user.Id, Username: user.Username, DisplayName: user.DisplayName, Email: user.Email, Group: user.Group},
		"usage":   connectorUsage{WalletQuotaRemaining: int64(max(user.Quota, 0)), LifetimeQuotaUsed: int64(max(user.UsedQuota, 0)), LifetimeRequestCount: int64(user.RequestCount)},
		"billing": gin.H{"wallet_fallback_allowed": walletFallback, "subscriptions": subscriptions},
	}})
}
