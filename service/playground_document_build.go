package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
)

// DocumentBuildFile references an object already in the asset bucket that the sandbox should see
// on disk before the build script runs.
type DocumentBuildFile struct {
	Path  string `json:"path"`
	R2Key string `json:"r2_key"`
}

// DocumentArtifact is one file the build script produced, already written to the asset bucket by
// the worker under the prefix the backend chose.
type DocumentArtifact struct {
	Name  string `json:"name"`
	R2Key string `json:"r2_key"`
	Bytes int64  `json:"bytes"`
	Mime  string `json:"mime"`
	// Verified means the file was reopened inside the container with the library that owns its
	// format. An unverified office document is a file the user's Word or Excel may refuse.
	Verified bool `json:"verified"`
}

type DocumentBuildLogs struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
}

type DocumentBuildResult struct {
	Status     string             `json:"status"`
	Artifacts  []DocumentArtifact `json:"artifacts"`
	ExitCode   int                `json:"exit_code"`
	DurationMs int                `json:"duration_ms"`
	Error      string             `json:"error"`
	Logs       DocumentBuildLogs  `json:"logs"`
}

type DocumentBuildRequest struct {
	JobId            string              `json:"job_id"`
	SandboxKey       string              `json:"sandbox_key"`
	Code             string              `json:"code"`
	Instance         string              `json:"instance,omitempty"`
	SleepAfterSec    int                 `json:"sleep_after_sec,omitempty"`
	TimeoutMs        int                 `json:"timeout_ms,omitempty"`
	MaxArtifactBytes int64               `json:"max_artifact_bytes,omitempty"`
	ArtifactPrefix   string              `json:"artifact_prefix,omitempty"`
	Inputs           []DocumentBuildFile `json:"inputs,omitempty"`
	Previous         []DocumentBuildFile `json:"previous,omitempty"`
}

// ErrDocumentBuilderUnavailable means the feature is switched off, misconfigured, or the user's
// group is not in the rollout yet. Callers turn it into a plain "not available" response rather
// than leaking which of those it was.
var ErrDocumentBuilderUnavailable = errors.New("document builder is not available")

// ErrDocumentBuildBusy means the user already has the allowed number of builds in flight.
var ErrDocumentBuildBusy = errors.New("too many document builds in flight")

// DocumentBuilderAvailable reports whether a user in the given group can build documents right
// now. Artifacts are written straight into the asset bucket by the worker, so the app has to be
// reading assets out of that same bucket; on a local-disk backend the returned keys would point
// at nothing.
func DocumentBuilderAvailable(group string) bool {
	settings := system_setting.GetDocumentBuilderSettings()
	return settings.AvailableToGroup(group) && storage.Default().Backend() == "r2"
}

// PlaygroundDocumentSandboxKey scopes a container to one conversation. Edits within a
// conversation reuse the warm container; unrelated conversations never share one.
func PlaygroundDocumentSandboxKey(userId, conversationId int) string {
	return fmt.Sprintf("doc:%d:%d", userId, conversationId)
}

// PlaygroundDocumentArtifactPrefix places artifacts in the same user-scoped namespace as
// uploads, so a produced file is delivered by exactly the same code path as an uploaded one.
func PlaygroundDocumentArtifactPrefix(userId int, jobId string) string {
	return fmt.Sprintf("uploads/%d/%s", userId, jobId)
}

// AcquireDocumentBuildSlot bounds how many sandboxes one user can hold at once. A container is
// the expensive resource here, and the wall clock alone does not stop a client from opening many
// at the same moment. Slots expire on their own so a crashed request cannot strand one.
//
// Without Redis the guard degrades to allowing the build: single-node deployments cannot be
// abused across processes, and refusing every build would be worse than the risk.
func AcquireDocumentBuildSlot(userId int, limit int, ttl time.Duration) (release func(), err error) {
	if !common.RedisEnabled {
		return func() {}, nil
	}
	ctx := context.Background()
	for slot := 0; slot < limit; slot++ {
		key := fmt.Sprintf("doc_build_slot:%d:%d", userId, slot)
		ok, setErr := common.RDB.SetNX(ctx, key, "1", ttl).Result()
		if setErr != nil {
			return func() {}, nil
		}
		if ok {
			return func() { _ = common.RedisDel(key) }, nil
		}
	}
	return nil, ErrDocumentBuildBusy
}

// RunPlaygroundDocumentBuild executes one build script in the sandbox worker.
//
// A failed build script is not an error from this function's point of view: the result carries
// the traceback that the self-heal retry needs. Errors returned here mean the request never
// reached a verdict.
func RunPlaygroundDocumentBuild(ctx context.Context, req DocumentBuildRequest) (*DocumentBuildResult, error) {
	settings := system_setting.GetDocumentBuilderSettings()
	if strings.TrimSpace(settings.BaseURL) == "" || strings.TrimSpace(settings.ServiceSecret) == "" {
		return nil, ErrDocumentBuilderUnavailable
	}
	if req.Instance == "" {
		req.Instance = settings.InstanceType
	}
	if req.SleepAfterSec == 0 {
		req.SleepAfterSec = settings.SleepAfterSeconds
	}
	if req.TimeoutMs == 0 {
		req.TimeoutMs = settings.WallClockSeconds * 1000
	}
	if req.MaxArtifactBytes == 0 {
		req.MaxArtifactBytes = settings.MaxArtifactBytes
	}

	body, err := common.Marshal(req)
	if err != nil {
		return nil, err
	}
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(settings.ServiceSecret))
	mac.Write([]byte(timestamp + "." + string(body)))

	endpoint := strings.TrimRight(settings.BaseURL, "/") + "/v1/build"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-BoxAI-Timestamp", timestamp)
	httpReq.Header.Set("X-BoxAI-Signature", hex.EncodeToString(mac.Sum(nil)))

	// The worker holds the request open for the whole build, so this has to outlast the sandbox
	// wall clock rather than race it.
	client := &http.Client{Timeout: time.Duration(req.TimeoutMs)*time.Millisecond + 30*time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result DocumentBuildResult
	if err := common.DecodeJson(resp.Body, &result); err != nil {
		return nil, fmt.Errorf("document builder returned an unreadable response (status %d)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		if result.Error == "" {
			result.Error = fmt.Sprintf("document builder returned status %d", resp.StatusCode)
		}
		return nil, errors.New(result.Error)
	}
	return &result, nil
}

// DestroyPlaygroundDocumentSandbox releases a conversation's container early, which is what
// leaving the conversation should do rather than paying for it to idle out.
func DestroyPlaygroundDocumentSandbox(ctx context.Context, sandboxKey string) error {
	settings := system_setting.GetDocumentBuilderSettings()
	if strings.TrimSpace(settings.BaseURL) == "" || strings.TrimSpace(settings.ServiceSecret) == "" {
		return ErrDocumentBuilderUnavailable
	}
	body, err := common.Marshal(map[string]string{"sandbox_key": sandboxKey, "instance": settings.InstanceType})
	if err != nil {
		return err
	}
	timestamp := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, []byte(settings.ServiceSecret))
	mac.Write([]byte(timestamp + "." + string(body)))

	endpoint := strings.TrimRight(settings.BaseURL, "/") + "/v1/destroy"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-BoxAI-Timestamp", timestamp)
	httpReq.Header.Set("X-BoxAI-Signature", hex.EncodeToString(mac.Sum(nil)))

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("document builder returned status %d", resp.StatusCode)
	}
	return nil
}

// PlaygroundDocumentArtifactKind maps a produced file onto the playground asset taxonomy. The
// worker reports the container's own guess at a MIME type, which is generic often enough that
// the extension is the more reliable signal.
func PlaygroundDocumentArtifactKind(name string) (kind string, mime string) {
	switch strings.ToLower(path.Ext(name)) {
	case ".docx":
		return "document", MimeDocx
	case ".xlsx":
		return "document", MimeXlsx
	case ".pptx":
		return "document", MimePptx
	case ".pdf":
		return "document", "application/pdf"
	case ".csv":
		return "document", "text/csv"
	case ".md", ".txt":
		return "document", "text/plain; charset=utf-8"
	case ".png":
		return "image", "image/png"
	case ".jpg", ".jpeg":
		return "image", "image/jpeg"
	case ".svg":
		return "image", "image/svg+xml"
	default:
		return "document", "application/octet-stream"
	}
}
