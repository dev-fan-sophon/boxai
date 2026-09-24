package controller

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/oauth"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type githubTestTransport func(*http.Request) (*http.Response, error)

func (f githubTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGitHubLegacyMigration(t *testing.T) {
	for _, tc := range []struct {
		name, body, email, legacy, change string
		status                            int
		ok                                bool
	}{
		{name: "verified secondary email", body: `[{"email":"OWNER@example.com","verified":true,"primary":false}]`, ok: true},
		{name: "reused username", body: `[{"email":"attacker@example.com","verified":true}]`},
		{name: "unverified profile match", body: `[{"email":"owner@example.com","verified":false}]`},
		{name: "missing scope", status: 403},
		{name: "malformed response", body: `{`},
		{name: "no stored email", email: " "},
		{name: "numeric legacy", legacy: "999999999999999999999999999999"},
		{name: "concurrent unlink", change: "binding", body: `[{"email":"owner@example.com","verified":true}]`},
		{name: "concurrent email change", change: "email", body: `[{"email":"owner@example.com","verified":true}]`},
		{name: "numeric identity claimed during verification", change: "claimed", body: `[{"email":"owner@example.com","verified":true}]`},
		{name: "update failure", change: "error", body: `[{"email":"owner@example.com","verified":true}]`},
		{name: "numeric login needs no email", legacy: "123", ok: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			oldDB, oldRegister, oldTransport := model.DB, common.RegisterEnabled, http.DefaultTransport
			model.DB, common.RegisterEnabled = db, false
			t.Cleanup(func() {
				model.DB = oldDB
				common.RegisterEnabled = oldRegister
				http.DefaultTransport = oldTransport
				sqlDB, _ := db.DB()
				sqlDB.Close()
			})
			require.NoError(t, db.AutoMigrate(&model.User{}))
			legacy, email := tc.legacy, tc.email
			if legacy == "" {
				legacy = "old-name"
			}
			if email == "" {
				email = "owner@example.com"
			}
			stored := model.User{Username: "owner", GitHubId: legacy, Email: email, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&stored).Error)
			calls := 0
			http.DefaultTransport = githubTestTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				assert.Equal(t, "https://api.github.com/user/emails", r.URL.String())
				assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
				switch tc.change {
				case "binding":
					require.NoError(t, db.Model(&model.User{}).Where("id = ?", stored.Id).Update("github_id", "other").Error)
				case "email":
					require.NoError(t, db.Model(&model.User{}).Where("id = ?", stored.Id).Update("email", "changed@example.com").Error)
				case "claimed":
					require.NoError(t, db.Create(&model.User{Username: "other", GitHubId: "123", AffCode: "other"}).Error)
				case "error":
					require.NoError(t, db.Callback().Update().Before("gorm:update").Register("reject", func(tx *gorm.DB) { tx.AddError(errors.New("write failed")) }))
				}
				status := tc.status
				if status == 0 {
					status = 200
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "/", nil)
			user, err := findOrCreateOAuthUser(c, &oauth.GitHubProvider{}, &oauth.OAuthUser{ProviderUserID: "123", Email: "owner@example.com", Extra: map[string]any{"legacy_id": legacy}}, nil, &oauth.OAuthToken{AccessToken: "test-token"})
			if tc.ok {
				require.NoError(t, err)
				require.NotNil(t, user)
				assert.Equal(t, stored.Id, user.Id)
				assert.Equal(t, "123", user.GitHubId)
			} else {
				require.Error(t, err)
				assert.Nil(t, user)
			}
			var after model.User
			require.NoError(t, db.First(&after, stored.Id).Error)
			if tc.ok {
				assert.Equal(t, "123", after.GitHubId)
			} else if tc.change == "binding" {
				assert.Equal(t, "other", after.GitHubId)
			} else {
				assert.Equal(t, legacy, after.GitHubId)
			}
			if tc.legacy != "" || tc.email == " " {
				assert.Zero(t, calls)
			}
		})
	}
}
