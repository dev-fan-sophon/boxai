package service

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
)

// FileReferencePrefix marks a file uploaded through POST /v1/files. Anywhere a
// media URL is accepted, the `file-<id>` handle stands in for it: the relay
// swaps in a URL the upstream provider can fetch, so API clients never deal
// with storage keys, signatures or expiries, and never inline base64 payloads
// (which upstream video APIs reject once the request body passes their limit).
const FileReferencePrefix = "file-"

// IsFileReference reports whether raw is a BoxAI file handle.
func IsFileReference(raw string) bool {
	return strings.HasPrefix(strings.TrimSpace(raw), FileReferencePrefix)
}

// ResolveFileReference maps a `file-<id>` handle onto a fetchable URL owned by
// userID. Values that are not handles pass through unchanged.
func ResolveFileReference(userID int, raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if !IsFileReference(trimmed) {
		return raw, nil
	}
	id, err := strconv.Atoi(strings.TrimPrefix(trimmed, FileReferencePrefix))
	if err != nil || id <= 0 {
		return "", fmt.Errorf("invalid file reference %q", trimmed)
	}
	asset, err := model.GetPlaygroundAsset(id, userID)
	if err != nil || asset == nil {
		return "", fmt.Errorf("file %s not found", trimmed)
	}
	origin := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if origin == "" {
		return "", fmt.Errorf("file references require a public server address")
	}
	resolved, err := PrivateReferenceMediaURL(fmt.Sprintf("/api/playground/assets/%d/content", id), origin, userID)
	if err != nil {
		return "", fmt.Errorf("file %s is unavailable: %w", trimmed, err)
	}
	return resolved, nil
}

// ResolveFileReferences resolves a list of media URLs, leaving non-handles as
// they are. The input slice is copied only when something needs resolving.
func ResolveFileReferences(userID int, values []string) ([]string, error) {
	resolved := values
	copied := false
	for i, value := range values {
		if !IsFileReference(value) {
			continue
		}
		if !copied {
			resolved = append([]string{}, values...)
			copied = true
		}
		url, err := ResolveFileReference(userID, value)
		if err != nil {
			return nil, err
		}
		resolved[i] = url
	}
	return resolved, nil
}

// ResolveFileReferencesInJSON rewrites every `file-<id>` string inside a raw
// JSON media field (a URL string, an array, or an `{url}`/`{image_url}` object)
// into a fetchable URL. Requests without handles keep their exact bytes.
func ResolveFileReferencesInJSON(userID int, raw []byte) ([]byte, error) {
	if len(raw) == 0 || !strings.Contains(string(raw), FileReferencePrefix) {
		return raw, nil
	}
	var value any
	if err := common.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("decode media reference: %w", err)
	}
	changed, err := resolveFileReferencesInValue(userID, &value)
	if err != nil {
		return nil, err
	}
	if !changed {
		return raw, nil
	}
	return common.Marshal(value)
}

func resolveFileReferencesInValue(userID int, value *any) (bool, error) {
	switch current := (*value).(type) {
	case string:
		if !IsFileReference(current) {
			return false, nil
		}
		resolved, err := ResolveFileReference(userID, current)
		if err != nil {
			return false, err
		}
		*value = resolved
		return true, nil
	case []any:
		changed := false
		for i := range current {
			itemChanged, err := resolveFileReferencesInValue(userID, &current[i])
			if err != nil {
				return false, err
			}
			changed = changed || itemChanged
		}
		return changed, nil
	case map[string]any:
		changed := false
		for _, key := range []string{"url", "image_url", "video_url", "audio_url"} {
			nested, ok := current[key]
			if !ok {
				continue
			}
			itemChanged, err := resolveFileReferencesInValue(userID, &nested)
			if err != nil {
				return false, err
			}
			if itemChanged {
				current[key] = nested
			}
			changed = changed || itemChanged
		}
		return changed, nil
	default:
		return false, nil
	}
}
