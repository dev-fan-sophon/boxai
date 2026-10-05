package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTurnstileCheckVerifiesEveryProtectedRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalEnabled := common.TurnstileCheckEnabled
	originalSecret := common.TurnstileSecretKey
	originalURL := turnstileSiteverifyURL
	originalClient := turnstileHTTPClient
	t.Cleanup(func() {
		common.TurnstileCheckEnabled = originalEnabled
		common.TurnstileSecretKey = originalSecret
		turnstileSiteverifyURL = originalURL
		turnstileHTTPClient = originalClient
	})

	requests := 0
	verifier := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		require.NoError(t, r.ParseForm())
		assert.Equal(t, "secret", r.Form.Get("secret"))
		assert.Equal(t, "token", r.Form.Get("response"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true}`))
	}))
	defer verifier.Close()

	common.TurnstileCheckEnabled = true
	common.TurnstileSecretKey = "secret"
	turnstileSiteverifyURL = verifier.URL
	turnstileHTTPClient = verifier.Client()

	router := gin.New()
	router.Use(TurnstileCheck())
	router.POST("/protected", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	for range 2 {
		req := httptest.NewRequest(http.MethodPost, "/protected", nil)
		req.Header.Set(turnstileTokenHeader, "token")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		assert.Equal(t, http.StatusNoContent, response.Code)
	}
	assert.Equal(t, 2, requests)
}

func TestTurnstileCheckFailsClosed(t *testing.T) {
	originalEnabled := common.TurnstileCheckEnabled
	originalSecret := common.TurnstileSecretKey
	originalURL := turnstileSiteverifyURL
	originalClient := turnstileHTTPClient
	t.Cleanup(func() {
		common.TurnstileCheckEnabled = originalEnabled
		common.TurnstileSecretKey = originalSecret
		turnstileSiteverifyURL = originalURL
		turnstileHTTPClient = originalClient
	})

	verifier := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer verifier.Close()
	common.TurnstileCheckEnabled = true
	common.TurnstileSecretKey = "secret"
	turnstileSiteverifyURL = verifier.URL
	turnstileHTTPClient = verifier.Client()

	router := gin.New()
	router.Use(TurnstileCheck())
	router.POST("/protected", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	for _, token := range []string{"", "token"} {
		req := httptest.NewRequest(http.MethodPost, "/protected", nil)
		if token != "" {
			req.Header.Set(turnstileTokenHeader, token)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		assert.Equal(t, http.StatusOK, response.Code)
		assert.JSONEq(t, `{"success":false,"message":"Human verification failed. Please try again."}`, response.Body.String())
	}
}

func TestTurnstileRejectsReplayMalformedResponseAndCanceledRequest(t *testing.T) {
	oldEnabled, oldSecret, oldURL, oldClient := common.TurnstileCheckEnabled, common.TurnstileSecretKey, turnstileSiteverifyURL, turnstileHTTPClient
	t.Cleanup(func() {
		common.TurnstileCheckEnabled, common.TurnstileSecretKey, turnstileSiteverifyURL, turnstileHTTPClient = oldEnabled, oldSecret, oldURL, oldClient
	})
	common.TurnstileCheckEnabled = true
	common.TurnstileSecretKey = "test-secret"
	for _, tc := range []struct {
		name, body string
		cancel     bool
	}{
		{"replayed", `{"success":false,"error-codes":["timeout-or-duplicate"]}`, false},
		{"malformed", `{"success":`, false},
		{"missing-result", `{}`, false},
		{"canceled", `{"success":true}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(tc.body)) }))
			defer server.Close()
			turnstileSiteverifyURL, turnstileHTTPClient = server.URL, server.Client()
			router := gin.New()
			router.POST("/action", TurnstileCheck(), func(c *gin.Context) { t.Error("verification failure reached action") })
			req := httptest.NewRequest(http.MethodPost, "/action", nil)
			req.Header.Set(turnstileTokenHeader, "token")
			if tc.cancel {
				ctx, cancel := context.WithCancel(req.Context())
				cancel()
				req = req.WithContext(ctx)
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			assert.Contains(t, w.Body.String(), `"success":false`)
		})
	}
	common.TurnstileCheckEnabled = false
	router := gin.New()
	router.POST("/disabled", TurnstileCheck(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/disabled", strings.NewReader("")))
	assert.Equal(t, http.StatusNoContent, w.Code)
}
