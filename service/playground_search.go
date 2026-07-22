package service

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// SearchProvider returns short text snippets for playground web search.
type SearchProvider interface {
	// Search returns a human-readable block of results (markdown-ish plain text).
	Search(query string, maxResults int) (string, error)
	// Configured reports whether the provider can run.
	Configured() bool
}

// NoopSearchProvider is used when search is not configured.
type NoopSearchProvider struct{}

func (NoopSearchProvider) Configured() bool { return false }

func (NoopSearchProvider) Search(query string, maxResults int) (string, error) {
	return "", fmt.Errorf("web search is not configured (set PLAYGROUND_SEARCH_URL)")
}

// HTTPSearchProvider calls a simple HTTP search API.
// Expected: GET {url}?q={query}&limit={n} with optional Authorization: Bearer {key}
// Response body is used as the result text (JSON or plain). Operators can point
// this at a small proxy that wraps SerpAPI / Bing / custom index.
type HTTPSearchProvider struct {
	BaseURL string
	APIKey  string
	Client  *http.Client
}

func (p *HTTPSearchProvider) Configured() bool {
	return strings.TrimSpace(p.BaseURL) != ""
}

func (p *HTTPSearchProvider) Search(query string, maxResults int) (string, error) {
	if !p.Configured() {
		return "", fmt.Errorf("web search is not configured")
	}
	if maxResults <= 0 {
		maxResults = 5
	}
	if maxResults > 10 {
		maxResults = 10
	}
	u, err := url.Parse(p.BaseURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	if q.Get("q") == "" {
		q.Set("q", query)
	}
	if q.Get("limit") == "" {
		q.Set("limit", fmt.Sprintf("%d", maxResults))
	}
	u.RawQuery = q.Encode()

	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	if p.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.APIKey)
	}
	req.Header.Set("Accept", "application/json, text/plain;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("search provider status %d: %s", resp.StatusCode, truncateStr(string(body), 200))
	}
	text := strings.TrimSpace(string(body))
	if text == "" {
		return "", fmt.Errorf("empty search response")
	}
	return text, nil
}

// GetPlaygroundSearchProvider returns the configured provider or noop.
func GetPlaygroundSearchProvider() SearchProvider {
	base := strings.TrimSpace(os.Getenv("PLAYGROUND_SEARCH_URL"))
	if base == "" {
		return NoopSearchProvider{}
	}
	return &HTTPSearchProvider{
		BaseURL: base,
		APIKey:  strings.TrimSpace(os.Getenv("PLAYGROUND_SEARCH_API_KEY")),
	}
}

// BuildWebSearchSystemSnippet formats search results for injection as context.
func BuildWebSearchSystemSnippet(query, results string) string {
	return fmt.Sprintf(
		"Web search results for %q (use when relevant; cite sources if present):\n\n%s",
		query,
		results,
	)
}

// MaxPlaygroundSearchQueryRunes caps outbound search query size (abuse / provider cost).
const MaxPlaygroundSearchQueryRunes = 1500

// ExtractLastUserQuery finds the last user message content for search.
func ExtractLastUserQuery(messages []map[string]any) string {
	for i := len(messages) - 1; i >= 0; i-- {
		role, _ := messages[i]["role"].(string)
		if role != "user" {
			continue
		}
		var q string
		switch v := messages[i]["content"].(type) {
		case string:
			q = strings.TrimSpace(v)
		default:
			b, err := common.Marshal(v)
			if err == nil {
				q = truncateStr(string(b), MaxPlaygroundSearchQueryRunes)
			}
		}
		if q == "" {
			continue
		}
		return truncateRunes(q, MaxPlaygroundSearchQueryRunes)
	}
	return ""
}

func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
