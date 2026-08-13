package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/i18n"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
	"github.com/gin-gonic/gin"
)

const (
	FacebookGraphVersion          = "v21.0"
	FacebookAuthorizationEndpoint = "https://www.facebook.com/" + FacebookGraphVersion + "/dialog/oauth"
	FacebookTokenEndpoint         = "https://graph.facebook.com/" + FacebookGraphVersion + "/oauth/access_token"
	FacebookUserInfoEndpoint      = "https://graph.facebook.com/" + FacebookGraphVersion + "/me?fields=id,name,email"
	FacebookScopes                = "public_profile,email"
)

func init() {
	Register("facebook", &FacebookProvider{})
}

// FacebookProvider implements OAuth for Facebook Login
type FacebookProvider struct{}

type facebookOAuthResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	Error       struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    int    `json:"code"`
	} `json:"error"`
}

type facebookUser struct {
	Id    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (p *FacebookProvider) GetName() string {
	return "Facebook"
}

func (p *FacebookProvider) IsEnabled() bool {
	return system_setting.GetFacebookSettings().Enabled
}

func (p *FacebookProvider) ExchangeToken(ctx context.Context, code string, c *gin.Context) (*OAuthToken, error) {
	if code == "" {
		return nil, NewOAuthError(i18n.MsgOAuthInvalidCode, nil)
	}

	logger.LogDebug(ctx, "[OAuth-Facebook] ExchangeToken: code=%s...", code[:min(len(code), 10)])

	settings := system_setting.GetFacebookSettings()
	redirectUri := fmt.Sprintf("%s/oauth/facebook", system_setting.ServerAddress)
	values := url.Values{}
	values.Set("client_id", settings.ClientId)
	values.Set("client_secret", settings.ClientSecret)
	values.Set("code", code)
	values.Set("redirect_uri", redirectUri)

	logger.LogDebug(ctx, "[OAuth-Facebook] ExchangeToken: redirect_uri=%s", redirectUri)

	req, err := http.NewRequestWithContext(ctx, "POST", FacebookTokenEndpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := http.Client{
		Timeout: 20 * time.Second,
	}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Facebook] ExchangeToken error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Facebook"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-Facebook] ExchangeToken response status: %d", res.StatusCode)

	var facebookResponse facebookOAuthResponse
	err = json.NewDecoder(res.Body).Decode(&facebookResponse)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Facebook] ExchangeToken decode error: %s", err.Error()))
		return nil, err
	}

	if facebookResponse.Error.Message != "" {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Facebook] ExchangeToken OAuth error: %s", facebookResponse.Error.Message))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Facebook"}, facebookResponse.Error.Message)
	}

	if facebookResponse.AccessToken == "" {
		logger.LogError(ctx, "[OAuth-Facebook] ExchangeToken failed: empty access token")
		return nil, NewOAuthError(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Facebook"})
	}

	logger.LogDebug(ctx, "[OAuth-Facebook] ExchangeToken success")

	return &OAuthToken{
		AccessToken: facebookResponse.AccessToken,
		TokenType:   facebookResponse.TokenType,
		ExpiresIn:   facebookResponse.ExpiresIn,
	}, nil
}

func (p *FacebookProvider) GetUserInfo(ctx context.Context, token *OAuthToken) (*OAuthUser, error) {
	logger.LogDebug(ctx, "[OAuth-Facebook] GetUserInfo: fetching user info")

	req, err := http.NewRequestWithContext(ctx, "GET", FacebookUserInfoEndpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Accept", "application/json")

	client := http.Client{
		Timeout: 20 * time.Second,
	}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Facebook] GetUserInfo error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Facebook"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-Facebook] GetUserInfo response status: %d", res.StatusCode)

	if res.StatusCode != http.StatusOK {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Facebook] GetUserInfo failed: status=%d", res.StatusCode))
		return nil, NewOAuthError(i18n.MsgOAuthGetUserErr, nil)
	}

	var facebookUser facebookUser
	err = json.NewDecoder(res.Body).Decode(&facebookUser)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-Facebook] GetUserInfo decode error: %s", err.Error()))
		return nil, err
	}

	if facebookUser.Id == "" {
		logger.LogError(ctx, "[OAuth-Facebook] GetUserInfo failed: empty id field")
		return nil, NewOAuthError(i18n.MsgOAuthUserInfoEmpty, map[string]any{"Provider": "Facebook"})
	}

	logger.LogDebug(ctx, "[OAuth-Facebook] GetUserInfo success: id=%s, name=%s, email=%s",
		facebookUser.Id, facebookUser.Name, facebookUser.Email)

	// Facebook only returns email when the app is approved for the email permission
	// and the user granted it, so an account may be created without one.
	return &OAuthUser{
		ProviderUserID: facebookUser.Id,
		DisplayName:    facebookUser.Name,
		Email:          facebookUser.Email,
	}, nil
}

func (p *FacebookProvider) IsUserIDTaken(providerUserID string) bool {
	return model.IsFacebookIdAlreadyTaken(providerUserID)
}

func (p *FacebookProvider) FillUserByProviderID(user *model.User, providerUserID string) error {
	user.FacebookId = providerUserID
	return user.FillUserByFacebookId()
}

func (p *FacebookProvider) SetProviderUserID(user *model.User, providerUserID string) {
	user.FacebookId = providerUserID
}

func (p *FacebookProvider) GetProviderPrefix() string {
	return "facebook_"
}

func (p *FacebookProvider) ProviderUserIDColumn() string {
	return "facebook_id"
}
