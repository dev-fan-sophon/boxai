package common

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// BoxAI's canonical Cloudflare account (小 QQ), also used by its email domain.
const cloudflareEmailURL = "https://api.cloudflare.com/client/v4/accounts/4379d21a3d3eadc0e37d63abff091f31/email/sending/send"

var cloudflareEmailClient = &http.Client{
	Timeout: 45 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func sendCloudflareEmail(subject, receiver, content string) error {
	if SMTPToken == "" {
		return fmt.Errorf("Cloudflare email sending token is not configured")
	}
	recipients := strings.Split(receiver, ";")
	for i := range recipients {
		recipients[i] = strings.TrimSpace(recipients[i])
	}
	body, err := Marshal(map[string]any{
		"from":    map[string]string{"address": SMTPFrom, "name": SystemName},
		"to":      recipients,
		"subject": subject,
		"html":    content,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, cloudflareEmailURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+SMTPToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := cloudflareEmailClient.Do(req)
	if err != nil {
		return fmt.Errorf("Cloudflare email request failed: %w", err)
	}
	defer resp.Body.Close()
	// Do not expose upstream bodies (which may contain recipient data) to users.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Cloudflare email request failed (HTTP %d)", resp.StatusCode)
	}
	var result struct {
		Success bool `json:"success"`
		Result  struct {
			Delivered        []string `json:"delivered"`
			Queued           []string `json:"queued"`
			PermanentBounces []string `json:"permanent_bounces"`
		} `json:"result"`
	}
	if err := DecodeJson(io.LimitReader(resp.Body, 1<<20), &result); err != nil {
		return fmt.Errorf("invalid Cloudflare email response")
	}
	if !result.Success || len(result.Result.PermanentBounces) > 0 {
		return fmt.Errorf("Cloudflare email delivery was rejected")
	}
	for _, recipient := range recipients {
		accepted := false
		for _, address := range append(result.Result.Delivered, result.Result.Queued...) {
			if strings.EqualFold(address, recipient) {
				accepted = true
				break
			}
		}
		if !accepted {
			return fmt.Errorf("Cloudflare did not accept all email recipients")
		}
	}
	return nil
}
