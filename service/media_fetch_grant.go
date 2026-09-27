package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/model"
)

const mediaFetchGrantTTL = 15 * time.Minute

// mediaFetchSecret deliberately excludes common's random per-process defaults.
func mediaFetchSecret() string {
	secret := os.Getenv("CRYPTO_SECRET")
	if secret == "" {
		secret = os.Getenv("SESSION_SECRET")
	}
	if secret == "random_string" {
		return ""
	}
	return secret
}

// IssueMediaFetchGrant creates a retryable, scoped capability shared by instances.
func IssueMediaFetchGrant(userID, assetID int) (string, error) {
	secret := mediaFetchSecret()
	if userID <= 0 || assetID <= 0 || secret == "" {
		return "", fmt.Errorf("invalid media fetch grant")
	}
	if _, err := GetMediaFetchAsset(userID, assetID); err != nil {
		return "", err
	}
	payload := fmt.Sprintf("media-fetch-v1:%d:%d:%d", userID, assetID, time.Now().Add(mediaFetchGrantTTL).Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	token := base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return "/api/playground/media-fetch/" + token, nil
}

// ConsumeMediaFetchGrant validates without process-local state. Retries are allowed.
func ConsumeMediaFetchGrant(token string) (userID, assetID int, ok bool) {
	secret := mediaFetchSecret()
	parts := strings.Split(token, ".")
	if secret == "" || len(token) > 512 || len(parts) != 2 {
		return 0, 0, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, 0, false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	if err != nil || !hmac.Equal(sig, mac.Sum(nil)) {
		return 0, 0, false
	}
	claims := strings.Split(string(payload), ":")
	if len(claims) != 4 || claims[0] != "media-fetch-v1" {
		return 0, 0, false
	}
	userID, e1 := strconv.Atoi(claims[1])
	assetID, e2 := strconv.Atoi(claims[2])
	expires, e3 := strconv.ParseInt(claims[3], 10, 64)
	if e1 != nil || e2 != nil || e3 != nil || userID <= 0 || assetID <= 0 || expires <= time.Now().Unix() {
		return 0, 0, false
	}
	return userID, assetID, true
}

// GetMediaFetchAsset checks ownership and limits this capability to reference media.
func GetMediaFetchAsset(userID, assetID int) (*model.PlaygroundAsset, error) {
	asset, err := model.GetPlaygroundAsset(assetID, userID)
	if err != nil {
		return nil, err
	}
	if asset.UploadState != "" && asset.UploadState != "ready" {
		return nil, fmt.Errorf("reference media upload is not ready")
	}
	if asset.Kind != "image" && asset.Kind != "video" && asset.Kind != "audio" {
		return nil, fmt.Errorf("asset is not reference media")
	}
	return asset, nil
}

// PrivateReferenceMediaURL converts only app-relative content references.
// External provider URLs (including data/asset URLs) retain their original value.
func PrivateReferenceMediaURL(raw, origin string, userID int) (string, error) {
	const prefix = "/api/playground/assets/"
	if !strings.HasPrefix(strings.TrimSpace(raw), prefix) {
		return raw, nil
	}
	ref := strings.TrimPrefix(strings.TrimSpace(raw), prefix)
	idText, suffix, found := strings.Cut(ref, "/")
	id, err := strconv.Atoi(idText)
	if err != nil || !found || suffix != "content" || id <= 0 {
		return "", fmt.Errorf("invalid private reference media URL")
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", fmt.Errorf("public server address required for reference media")
	}
	grant, err := IssueMediaFetchGrant(userID, id)
	if err != nil {
		return "", err
	}
	return AbsoluteMediaFetchURL(origin, grant), nil
}

// AbsoluteMediaFetchURL joins a public origin with a grant path.
func AbsoluteMediaFetchURL(origin, grantPath string) string {
	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	if origin == "" || grantPath == "" {
		return grantPath
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return grantPath
	}
	return origin + grantPath
}
