package service

import (
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
)

const mediaFetchGrantTTL = 15 * time.Minute

type mediaFetchGrant struct {
	UserID    int
	AssetID   int
	ExpiresAt time.Time
}

var mediaFetchGrants sync.Map

// IssueMediaFetchGrant returns a single-use path the video gateway can GET
// without a user session. The file stays private; the grant expires quickly.
func IssueMediaFetchGrant(userID, assetID int) (string, error) {
	if userID <= 0 || assetID <= 0 {
		return "", fmt.Errorf("invalid media fetch grant")
	}
	token, err := common.GenerateRandomCharsKey(32)
	if err != nil {
		return "", err
	}
	mediaFetchGrants.Store(token, mediaFetchGrant{
		UserID:    userID,
		AssetID:   assetID,
		ExpiresAt: time.Now().Add(mediaFetchGrantTTL),
	})
	return "/api/playground/media-fetch/" + token, nil
}

// ConsumeMediaFetchGrant validates a gateway fetch token. The grant stays
// valid until it expires so a gateway retry can fetch the same object once.
func ConsumeMediaFetchGrant(token string) (userID, assetID int, ok bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, 0, false
	}
	raw, found := mediaFetchGrants.Load(token)
	if !found {
		return 0, 0, false
	}
	grant, valid := raw.(mediaFetchGrant)
	if !valid || time.Now().After(grant.ExpiresAt) {
		mediaFetchGrants.Delete(token)
		return 0, 0, false
	}
	return grant.UserID, grant.AssetID, true
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
