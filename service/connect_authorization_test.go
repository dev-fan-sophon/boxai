package service

import (
	"strings"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupConnectAuthorizationTest(t *testing.T) *model.User {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	// Deliberately no Desktop tables or signing configuration.
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.ConnectAuthorization{}))
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old })
	user := &model.User{Username: "connect", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(user).Error)
	return user
}

func TestConnectGrantExchange(t *testing.T) {
	user := setupConnectAuthorizationTest(t)
	const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	const redirect = "http://127.0.0.1:49152/callback"
	a, err := CreateConnectAuthorization(redirect, challenge, "S256", desktopTestState, "Laptop")
	require.NoError(t, err)
	_, _, err = DecideConnectAuthorization(a.ID, 0, true)
	require.ErrorIs(t, err, ErrConnectInvalidGrant)
	code, _, err := DecideConnectAuthorization(a.ID, user.Id, true)
	require.NoError(t, err)
	_, _, err = DecideConnectAuthorization(a.ID, user.Id, true)
	assert.ErrorIs(t, err, ErrConnectInvalidGrant)
	for _, input := range []struct{ code, verifier, redirect string }{
		{strings.Repeat("x", 43), verifier, redirect},
		{code, verifier + "x", redirect},
		{code, "short", redirect},
		{code, verifier, "http://127.0.0.1:49153/callback"},
	} {
		_, err = ExchangeConnectCode(input.code, input.verifier, input.redirect)
		assert.ErrorIs(t, err, ErrConnectInvalidGrant)
	}
	key, err := ExchangeConnectCode(code, verifier, redirect)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(key, "sk-"))
	var tokens []model.Token
	require.NoError(t, model.DB.Find(&tokens).Error)
	require.Len(t, tokens, 1)
	assert.Equal(t, strings.TrimPrefix(key, "sk-"), tokens[0].Key)
	assert.Equal(t, user.Id, tokens[0].UserId)
	assert.Equal(t, "BoxAI Connect", tokens[0].Name)
	assert.Equal(t, common.TokenStatusEnabled, tokens[0].Status)
	assert.Equal(t, int64(-1), tokens[0].ExpiredTime)
	assert.True(t, tokens[0].UnlimitedQuota)
	_, err = ExchangeConnectCode(code, verifier, redirect)
	assert.ErrorIs(t, err, ErrConnectInvalidGrant)
}

func TestConnectGrantRejectsExpiredDeniedAndDisabledUsers(t *testing.T) {
	for _, scenario := range []string{"expired", "denied", "disabled", "deleted"} {
		t.Run(scenario, func(t *testing.T) {
			user := setupConnectAuthorizationTest(t)
			verifier := strings.Repeat("a", 43)
			redirect := "http://127.0.0.1:4321/auth/callback"
			a, err := CreateConnectAuthorization(redirect, pkce(verifier), "S256", desktopTestState, "")
			require.NoError(t, err)
			code, _, err := DecideConnectAuthorization(a.ID, user.Id, scenario != "denied")
			require.NoError(t, err)
			switch scenario {
			case "expired":
				require.NoError(t, model.DB.Model(a).Update("expires_at", time.Now().Unix()-1).Error)
			case "disabled":
				require.NoError(t, model.DB.Model(user).Update("status", common.UserStatusDisabled).Error)
			case "deleted":
				require.NoError(t, model.DB.Delete(user).Error)
			}
			_, err = ExchangeConnectCode(code, verifier, redirect)
			assert.ErrorIs(t, err, ErrConnectInvalidGrant)
			var count int64
			require.NoError(t, model.DB.Model(&model.Token{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestConnectAuthorizationValidation(t *testing.T) {
	setupConnectAuthorizationTest(t)
	for _, input := range []struct{ redirect, challenge, method, state string }{
		{"https://evil.example/callback", pkce(strings.Repeat("a", 43)), "S256", desktopTestState},
		{"http://127.0.0.1:4321/callback", "bad", "S256", desktopTestState},
		{"http://127.0.0.1:4321/callback", pkce(strings.Repeat("a", 43)), "plain", desktopTestState},
		{"http://127.0.0.1:4321/callback", pkce(strings.Repeat("a", 43)), "S256", "short"},
	} {
		_, err := CreateConnectAuthorization(input.redirect, input.challenge, input.method, input.state, "")
		assert.ErrorIs(t, err, ErrConnectInvalidGrant)
	}
}
