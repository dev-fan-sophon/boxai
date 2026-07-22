package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUniqueNonEmptyModels(t *testing.T) {
	got := uniqueNonEmpty([]string{" a ", "b", "a", "", "b", "c"})
	assert.Equal(t, []string{"a", "b", "c"}, got)
}

func TestPlaygroundMultiMaxModelsConstant(t *testing.T) {
	assert.Equal(t, 5, playgroundMultiMaxModels)
}

func TestPlaygroundMultiChat_Validation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name       string
		body       string
		wantSubstr string
	}{
		{
			name:       "missing answer models",
			body:       `{"summarizer_model":"m","messages":[{"role":"user","content":"hi"}]}`,
			wantSubstr: "answer_models",
		},
		{
			name:       "missing summarizer",
			body:       `{"answer_models":["a"],"messages":[{"role":"user","content":"hi"}]}`,
			wantSubstr: "summarizer",
		},
		{
			name:       "missing messages",
			body:       `{"answer_models":["a"],"summarizer_model":"s"}`,
			wantSubstr: "messages",
		},
		{
			name:       "too many models",
			body:       `{"answer_models":["a","b","c","d","e","f"],"summarizer_model":"s","messages":[{"role":"user","content":"hi"}]}`,
			wantSubstr: "max is 5",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			req := httptest.NewRequest(http.MethodPost, "/api/playground/chat/multi",
				bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			c.Request = req

			PlaygroundMultiChat(c)

			assert.Equal(t, http.StatusOK, w.Code)
			assert.Contains(t, w.Body.String(), tc.wantSubstr)
			assert.Contains(t, w.Body.String(), `"success":false`)
		})
	}
}

func TestPlaygroundAuthHeaders_NoDoubleCookie(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Cookie", "session=abc; other=1")
	req.Header.Set("Authorization", "Bearer tok")
	// Do not AddCookie here — that would mutate the Cookie header on the source
	// request. Production path: browser Cookie header is forwarded once.
	c.Request = req

	h := playgroundAuthHeaders(c)
	cookieVals := h.Values("Cookie")
	require.Len(t, cookieVals, 1, "must set Cookie header exactly once")
	assert.Equal(t, "session=abc; other=1", cookieVals[0])
	assert.Equal(t, "Bearer tok", h.Get("Authorization"))
	// Ensure we did not also emit Set-Cookie-style duplicates as multiple headers
	assert.Equal(t, 1, len(h["Cookie"]))
}

func TestPlaygroundAuthHeaders_FromCookiesOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: "xyz"})
	c.Request = req

	h := playgroundAuthHeaders(c)
	require.Len(t, h.Values("Cookie"), 1)
	assert.Contains(t, h.Get("Cookie"), "session=xyz")
}

func TestMultiMessageRuneCount(t *testing.T) {
	n := multiMessageRuneCount([]map[string]any{
		{"role": "user", "content": "你好"},
		{"role": "assistant", "content": "hi"},
	})
	assert.Equal(t, 4, n)
}

func TestTruncateRunes(t *testing.T) {
	assert.Equal(t, "你好", truncateRunes("你好世界", 2))
	assert.Equal(t, "abc", truncateRunes("abc", 10))
}

func TestAllowlistedResultURL(t *testing.T) {
	assert.Equal(t, "https://x.test/a.png", allowlistedResultURL("https://x.test/a.png"))
	assert.Equal(t, "http://x.test/a.png", allowlistedResultURL("http://x.test/a.png"))
	assert.Equal(t, "", allowlistedResultURL("javascript:alert(1)"))
	assert.Equal(t, "/api/playground/assets/1/content", allowlistedResultURL("/api/playground/assets/1/content"))
	assert.Equal(t, "", allowlistedResultURL("../etc/passwd"))
	// protocol-relative must not pass the same-origin "/" branch
	assert.Equal(t, "", allowlistedResultURL("//evil.example/x.png"))
	assert.Equal(t, "", allowlistedResultURL("//evil.example"))
	assert.Equal(t, "", allowlistedResultURL("/\\evil"))
	assert.Equal(t, "", allowlistedResultURL("/api//evil.example/x"))
}
