package oauth

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
)

const (
	ZaloAuthorizationEndpoint = "https://oauth.zaloapp.com/v4/permission"
	ZaloTokenEndpoint         = "https://oauth.zaloapp.com/v4/access_token"
	ZaloUserInfoEndpoint      = "https://graph.zalo.me/v2.0/me?fields=id,name,picture"
)

func init() {
	Register("zalo", &ZaloProvider{})
}

// ZaloProvider implements Zalo Social API OAuth v4, which deviates from standard
// OAuth 2.0: the app credentials are named app_id/secret_key, the secret travels
// in a request header, and the user info endpoint authenticates with a bare
// access_token header instead of Authorization: Bearer.
type ZaloProvider struct{}

type zaloOAuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    string `json:"expires_in"`
	Error        int    `json:"error"`
	ErrorName    string `json:"error_name"`
	ErrorReason  string `json:"error_reason"`
	Message      string `json:"message"`
}

type zaloUser struct {
	Id      string `json:"id"`
	Name    string `json:"name"`
	Error   int    `json:"error"`
	Message string `json:"message"`
}

func (p *ZaloProvider) GetName() string {
	return "Zalo"
}

func (p *ZaloProvider) IsEnabled() bool {
	return system_setting.GetZaloSettings().Enabled
}

func (p *ZaloProvider) ExchangeToken(ctx context.Context, code string, c *gin.Context) (*OAuthToken, error) {
	if code == "" {
		return nil, NewOAuthError(i18n.MsgOAuthInvalidCode, nil)
	}

	logger.LogDebug(ctx, "[OAuth-Zalo] ExchangeToken: code=%s...", code[:min(len(code), 10)])

	settings := system_setting.GetZaloSettings()
	values := url.Values{}
	values.Set("app_id", settings.AppId)
	values.Set("code", code)
	values.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, "POST", ZaloTokenEndpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("secret_key", settings.SecretKey)

	client := http.Client{
		Timeout: 20 * time.Second,
	}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] ExchangeToken error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Zalo"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-Zalo] ExchangeToken response status: %d", res.StatusCode)

	body, err := io.ReadAll(res.Body)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] ExchangeToken read body error: %s", err.Error()))
		return nil, err
	}

	var zaloResponse zaloOAuthResponse
	if err := common.Unmarshal(body, &zaloResponse); err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] ExchangeToken decode error: %s", err.Error()))
		return nil, err
	}

	if zaloResponse.Error != 0 {
		detail := zaloResponse.Message
		if detail == "" {
			detail = zaloResponse.ErrorName
		}
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] ExchangeToken failed: error=%d, message=%s, reason=%s",
			zaloResponse.Error, zaloResponse.Message, zaloResponse.ErrorReason))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Zalo"}, detail)
	}

	if zaloResponse.AccessToken == "" {
		logger.LogError(ctx, "[OAuth-Zalo] ExchangeToken failed: empty access token")
		return nil, NewOAuthError(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Zalo"})
	}

	logger.LogDebug(ctx, "[OAuth-Zalo] ExchangeToken success")

	expiresIn, _ := strconv.Atoi(zaloResponse.ExpiresIn)

	return &OAuthToken{
		AccessToken:  zaloResponse.AccessToken,
		TokenType:    "Bearer",
		RefreshToken: zaloResponse.RefreshToken,
		ExpiresIn:    expiresIn,
	}, nil
}

func (p *ZaloProvider) GetUserInfo(ctx context.Context, token *OAuthToken) (*OAuthUser, error) {
	logger.LogDebug(ctx, "[OAuth-Zalo] GetUserInfo: fetching user info")

	req, err := http.NewRequestWithContext(ctx, "GET", ZaloUserInfoEndpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("access_token", token.AccessToken)
	req.Header.Set("Accept", "application/json")

	client := http.Client{
		Timeout: 20 * time.Second,
	}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] GetUserInfo error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Zalo"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-Zalo] GetUserInfo response status: %d", res.StatusCode)

	if res.StatusCode != http.StatusOK {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] GetUserInfo failed: status=%d", res.StatusCode))
		return nil, NewOAuthError(i18n.MsgOAuthGetUserErr, nil)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] GetUserInfo read body error: %s", err.Error()))
		return nil, err
	}

	var zaloUser zaloUser
	if err := common.Unmarshal(body, &zaloUser); err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] GetUserInfo decode error: %s", err.Error()))
		return nil, err
	}

	if zaloUser.Error != 0 || zaloUser.Id == "" {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Zalo] GetUserInfo failed: error=%d, message=%s", zaloUser.Error, zaloUser.Message))
		return nil, NewOAuthError(i18n.MsgOAuthUserInfoEmpty, map[string]any{"Provider": "Zalo"})
	}

	logger.LogDebug(ctx, "[OAuth-Zalo] GetUserInfo success: id=%s, name=%s", zaloUser.Id, zaloUser.Name)

	// Zalo never returns an email address, so the account is created without one
	// and the user binds an email later from the profile page.
	return &OAuthUser{
		ProviderUserID: zaloUser.Id,
		DisplayName:    zaloUser.Name,
	}, nil
}

func (p *ZaloProvider) IsUserIDTaken(providerUserID string) bool {
	return model.IsZaloIdAlreadyTaken(providerUserID)
}

func (p *ZaloProvider) FillUserByProviderID(user *model.User, providerUserID string) error {
	user.ZaloId = providerUserID
	return user.FillUserByZaloId()
}

func (p *ZaloProvider) SetProviderUserID(user *model.User, providerUserID string) {
	user.ZaloId = providerUserID
}

func (p *ZaloProvider) GetProviderPrefix() string {
	return "zalo_"
}

func (p *ZaloProvider) ProviderUserIDColumn() string {
	return "zalo_id"
}
