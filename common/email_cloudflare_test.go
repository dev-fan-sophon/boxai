package common

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type emailRoundTripper func(*http.Request) (*http.Response, error)

func (f emailRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestSendEmailCloudflareHTTPS(t *testing.T) {
	withSMTPSettings(t)
	SMTPServer = "smtp.mx.cloudflare.net"
	SMTPFrom = "no-reply@you-box.com"
	SMTPToken = "test-scoped-token"
	original := cloudflareEmailClient
	t.Cleanup(func() { cloudflareEmailClient = original })
	for _, tt := range []struct {
		name   string
		status int
		body   string
		err    string
	}{
		{"delivered and queued", 200, `{"success":true,"result":{"delivered":["first@example.com"],"queued":["second@example.com"]}}`, ""},
		{"bounce despite success", 200, `{"success":true,"result":{"delivered":["first@example.com"],"permanent_bounces":["second@example.com"]}}`, "rejected"},
		{"partial acceptance", 200, `{"success":true,"result":{"queued":["first@example.com"]}}`, "not accept all"},
		{"wrong recipients", 200, `{"success":true,"result":{"delivered":["other@example.com","first@example.com"]}}`, "not accept all"},
		{"API failure", 200, `{"success":false,"errors":[{"message":"private upstream details"}]}`, "rejected"},
		{"empty result", 200, `{"success":true}`, "not accept all"},
		{"malformed response", 200, `<html>private upstream details</html>`, "invalid Cloudflare"},
		{"permission denied", 403, `private upstream details`, "HTTP 403"},
		{"rate limited", 429, `private upstream details`, "HTTP 429"},
		{"redirect", 302, `private upstream details`, "HTTP 302"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			client := *original
			client.Transport = emailRoundTripper(func(req *http.Request) (*http.Response, error) {
				calls++
				assert.Equal(t, "https://api.cloudflare.com/client/v4/accounts/4379d21a3d3eadc0e37d63abff091f31/email/sending/send", req.URL.String())
				assert.Equal(t, http.MethodPost, req.Method)
				assert.Equal(t, "Bearer test-scoped-token", req.Header.Get("Authorization"))
				assert.Equal(t, "application/json", req.Header.Get("Content-Type"))
				assert.Positive(t, req.ContentLength)
				var payload map[string]any
				require.NoError(t, DecodeJson(req.Body, &payload))
				assert.Equal(t, map[string]any{
					"from": map[string]any{"address": "no-reply@you-box.com", "name": SystemName},
					"to":   []any{"first@example.com", "second@example.com"}, "subject": "Xác minh 邮箱",
					"html": "<p>Code: 135790</p>",
				}, payload)
				return &http.Response{StatusCode: tt.status, Header: http.Header{"Location": {"https://other.example.com"}}, Body: io.NopCloser(strings.NewReader(tt.body)), Request: req}, nil
			})
			cloudflareEmailClient = &client
			err := SendEmail("Xác minh 邮箱", "first@example.com; second@example.com", "<p>Code: 135790</p>")
			if tt.err == "" {
				require.NoError(t, err)
			} else {
				require.ErrorContains(t, err, tt.err)
				assert.NotContains(t, err.Error(), "private upstream details")
				assert.NotContains(t, err.Error(), SMTPToken)
			}
			assert.Equal(t, 1, calls, "must not retry an ambiguous delivery or follow redirects")
		})
	}
	cloudflareEmailClient = &http.Client{Transport: emailRoundTripper(func(req *http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("connection unavailable")
	})}
	require.ErrorContains(t, SendEmail("subject", "first@example.com", "body"), "request failed")
	SMTPToken = ""
	require.ErrorContains(t, SendEmail("subject", "first@example.com", "body"), "token is not configured")
}
