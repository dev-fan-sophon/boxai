/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/pkg/errors"
)

const apiBaseURL = "https://api.cloudflare.com/client/v4"

// ErrNotConfigured is returned when an administrator has not supplied the API
// token and zone id yet, so the console can render a setup prompt instead of an
// error toast.
var ErrNotConfigured = errors.New("Cloudflare API token and zone ID are not configured")

// APIError carries Cloudflare's own error list. Quota rejections on the free
// plan arrive this way, so the text is surfaced to the administrator verbatim
// rather than being flattened into a generic failure.
type APIError struct {
	StatusCode int
	Errors     []APIErrorDetail
}

type APIErrorDetail struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *APIError) Error() string {
	if len(e.Errors) == 0 {
		return fmt.Sprintf("Cloudflare API request failed with status %d", e.StatusCode)
	}
	messages := make([]string, 0, len(e.Errors))
	for _, detail := range e.Errors {
		messages = append(messages, fmt.Sprintf("%s (code %d)", detail.Message, detail.Code))
	}
	return "Cloudflare API: " + strings.Join(messages, "; ")
}

// IsNotFound reports the "ruleset does not exist in this phase" style responses
// that are a normal state rather than a failure.
func IsNotFound(err error) bool {
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.StatusCode == http.StatusNotFound
}

type envelope struct {
	Success bool             `json:"success"`
	Errors  []APIErrorDetail `json:"errors"`
	Result  json.RawMessage  `json:"result"`
}

type Client struct {
	token      string
	zoneID     string
	accountID  string
	baseURL    string
	httpClient *http.Client
}

func NewClient() (*Client, error) {
	settings := system_setting.GetCloudflareSettings()
	if settings.APIToken == "" || settings.ZoneID == "" {
		return nil, ErrNotConfigured
	}
	return &Client{
		token:      settings.APIToken,
		zoneID:     settings.ZoneID,
		accountID:  settings.AccountID,
		baseURL:    apiBaseURL,
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}, nil
}

func (c *Client) ZoneID() string {
	return c.zoneID
}

func (c *Client) request(ctx context.Context, method string, path string, payload any, result any) error {
	var body io.Reader
	if payload != nil {
		encoded, err := common.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	res, err := c.httpClient.Do(req)
	if err != nil {
		return errors.Wrap(err, "Cloudflare API request failed")
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return err
	}

	var parsed envelope
	if err := common.Unmarshal(raw, &parsed); err != nil {
		return errors.Wrapf(err, "unexpected Cloudflare API response (status %d)", res.StatusCode)
	}
	if !parsed.Success {
		return &APIError{StatusCode: res.StatusCode, Errors: parsed.Errors}
	}
	if result == nil || len(parsed.Result) == 0 || string(parsed.Result) == "null" {
		return nil
	}
	return common.Unmarshal(parsed.Result, result)
}

func (c *Client) zonePath(suffix string) string {
	return "/zones/" + c.zoneID + suffix
}
