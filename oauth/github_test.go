package oauth

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type githubTransport func(*http.Request) (*http.Response, error)

func (f githubTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGitHubNumericLoginIsNotLegacyIdentity(t *testing.T) {
	for _, login := range []string{"123", "00012", "999999999999999999999999999999999", "old-name"} {
		t.Run(login, func(t *testing.T) {
			previous := http.DefaultTransport
			t.Cleanup(func() { http.DefaultTransport = previous })
			http.DefaultTransport = githubTransport(func(r *http.Request) (*http.Response, error) {
				assert.Equal(t, "/user", r.URL.Path)
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":42,"login":"` + login + `"}`))}, nil
			})
			user, err := (&GitHubProvider{}).GetUserInfo(context.Background(), &OAuthToken{AccessToken: "test"})
			require.NoError(t, err)
			assert.Equal(t, "42", user.ProviderUserID)
			assert.Equal(t, login, user.Username)
			if login == "old-name" {
				assert.Equal(t, login, user.Extra["legacy_id"])
			} else {
				assert.Empty(t, user.Extra["legacy_id"])
			}
		})
	}
}
