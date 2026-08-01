package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/service/storage"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
)

// documentRunState is the part of a document run the backend owns. It is stashed on the tool run
// so the build step reads its inputs from the server's record instead of trusting whatever the
// client sends at build time.
type documentRunState struct {
	ConversationId int      `json:"conversation_id"`
	AssetIds       []int    `json:"asset_ids"`
	PreviousKeys   []string `json:"previous_keys"`
	PreviousNames  []string `json:"previous_names"`
	LastCode       string   `json:"last_code"`
	Formats        []string `json:"formats"`
}

// PreparePlaygroundDocumentRun returns the system prompt that turns the user's own model into a
// build-script author, and records which files the build is allowed to read.
func PreparePlaygroundDocumentRun(c *gin.Context) {
	run := ownedDocumentRun(c)
	if run == nil {
		return
	}
	var body struct {
		ExecutionToken string `json:"execution_token"`
		ConversationId int    `json:"conversation_id"`
		AssetIds       []int  `json:"asset_ids"`
	}
	if err := common.DecodeJson(c.Request.Body, &body); err != nil || body.ExecutionToken != run.ExecutionToken {
		common.ApiErrorMsg(c, "invalid execution contract")
		return
	}
	if run.Status != "ready" {
		common.ApiErrorMsg(c, "run state conflict")
		return
	}

	settings := system_setting.GetDocumentBuilderSettings()
	state := documentRunState{
		ConversationId: body.ConversationId,
		Formats:        service.DetectPlaygroundDocumentFormats(run.Prompt),
	}
	prompt := service.PlaygroundDocumentPrompt{Formats: state.Formats, HTMLPdf: settings.BrowserPdfEnabled}
	if len(body.AssetIds) > 8 {
		common.ApiErrorMsg(c, "too many attachments")
		return
	}
	for _, assetId := range body.AssetIds {
		asset, err := model.GetPlaygroundAsset(assetId, run.UserId)
		if err != nil {
			common.ApiErrorMsg(c, "attachment is not owned by this user")
			return
		}
		state.AssetIds = append(state.AssetIds, asset.Id)
		prompt.Inputs = append(prompt.Inputs, documentInputName(asset))
	}

	// A follow-up in the same conversation edits the document that is already there. Finding it
	// server-side is what stops the model from silently regenerating and dropping content the
	// user never mentioned.
	if body.ConversationId > 0 {
		previous, err := model.LatestCompletedPlaygroundDocumentBuild(run.UserId, body.ConversationId)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiError(c, err)
			return
		}
		if previous != nil {
			var artifacts []service.DocumentArtifact
			_ = common.UnmarshalJsonStr(previous.ArtifactsJson, &artifacts)
			for _, artifact := range artifacts {
				if kind, _ := service.PlaygroundDocumentArtifactKind(artifact.Name); kind != "document" {
					continue
				}
				state.PreviousKeys = append(state.PreviousKeys, artifact.R2Key)
				state.PreviousNames = append(state.PreviousNames, artifact.Name)
				prompt.Previous = append(prompt.Previous, artifact.Name)
			}
			state.LastCode = previous.Code
		}
	}

	if err := saveDocumentRunState(run, state); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"system_prompt": service.BuildPlaygroundDocumentSystemPrompt(prompt),
		"inputs":        prompt.Inputs,
		"previous":      prompt.Previous,
	})
}

// BuildPlaygroundDocument runs one model-authored script in the sandbox and turns whatever it
// produced into assets.
//
// A script that fails is a normal outcome, not an error: the response carries the corrected
// prompt for the next attempt. Only a request that never reached a verdict is an error.
func BuildPlaygroundDocument(c *gin.Context) {
	run := ownedDocumentRun(c)
	if run == nil {
		return
	}
	var body struct {
		ExecutionToken string `json:"execution_token"`
		Code           string `json:"code"`
	}
	if err := common.DecodeJson(c.Request.Body, &body); err != nil || body.ExecutionToken != run.ExecutionToken {
		common.ApiErrorMsg(c, "invalid execution contract")
		return
	}
	code := strings.TrimSpace(body.Code)
	if code == "" {
		common.ApiErrorMsg(c, "the model did not return a build script")
		return
	}
	if len(code) > service.MaxPlaygroundDocumentCodeBytes {
		common.ApiErrorMsg(c, "build script is too large")
		return
	}
	if run.Status != "ready" && run.Status != "executing" {
		common.ApiErrorMsg(c, "run state conflict")
		return
	}

	settings := system_setting.GetDocumentBuilderSettings()
	if !service.DocumentBuilderAvailable(run.UsingGroup) {
		common.ApiErrorMsg(c, "document generation is not available")
		return
	}
	attempts, err := model.CountPlaygroundDocumentBuildAttempts(run.Id, run.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if int(attempts) >= settings.MaxAttempts {
		common.ApiErrorMsg(c, "this document has used all of its build attempts")
		return
	}

	var state documentRunState
	_ = common.UnmarshalJsonStr(run.ArgumentsJson, &state)

	release, err := service.AcquireDocumentBuildSlot(run.UserId, settings.MaxConcurrentPerUser,
		time.Duration(settings.WallClockSeconds+60)*time.Second)
	if err != nil {
		common.ApiErrorMsg(c, "another document is still building")
		return
	}
	defer release()

	if err := model.UpdatePlaygroundChatToolRunCAS(run.Id, run.UserId, run.Status, map[string]any{"status": "executing"}); err != nil {
		common.ApiErrorMsg(c, "run state conflict")
		return
	}

	jobId := uuid.NewString()
	build := &model.PlaygroundDocumentBuild{
		UserId:         run.UserId,
		RunId:          run.Id,
		ConversationId: state.ConversationId,
		SandboxKey:     service.PlaygroundDocumentSandboxKey(run.UserId, state.ConversationId),
		Status:         model.PlaygroundDocumentBuildBuilding,
		Attempt:        int(attempts) + 1,
		ChatModel:      run.ChatModel,
		Instance:       settings.InstanceType,
		Code:           code,
	}
	if err := model.CreatePlaygroundDocumentBuild(build); err != nil {
		common.ApiError(c, err)
		return
	}

	request := service.DocumentBuildRequest{
		JobId:          jobId,
		SandboxKey:     build.SandboxKey,
		Code:           code,
		ArtifactPrefix: service.PlaygroundDocumentArtifactPrefix(run.UserId, jobId),
	}
	for _, assetId := range state.AssetIds {
		asset, assetErr := model.GetPlaygroundAsset(assetId, run.UserId)
		if assetErr != nil {
			continue
		}
		request.Inputs = append(request.Inputs, service.DocumentBuildFile{Path: documentInputName(asset), R2Key: asset.StorageKey})
	}
	for i, key := range state.PreviousKeys {
		request.Previous = append(request.Previous, service.DocumentBuildFile{Path: state.PreviousNames[i], R2Key: key})
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(settings.WallClockSeconds+45)*time.Second)
	defer cancel()
	result, err := service.RunPlaygroundDocumentBuild(ctx, request)
	if err != nil {
		_ = model.UpdatePlaygroundDocumentBuild(build.Id, map[string]any{
			"status": model.PlaygroundDocumentBuildFailed, "error_message": err.Error(), "exit_code": -1,
		})
		common.SysError(fmt.Sprintf("document build %d transport failure: %s", build.Id, err.Error()))
		common.ApiErrorMsg(c, "the document service is unavailable, please try again")
		return
	}

	if result.Status != "completed" {
		respondFailedDocumentBuild(c, run, build, result, settings.MaxAttempts, code)
		return
	}

	assets := make([]*model.PlaygroundAsset, 0, len(result.Artifacts))
	for _, artifact := range result.Artifacts {
		asset, assetErr := persistDocumentArtifact(run.UserId, artifact)
		if assetErr != nil {
			common.SysError(fmt.Sprintf("document build %d could not record %s: %s", build.Id, artifact.Name, assetErr.Error()))
			continue
		}
		assets = append(assets, asset)
	}
	if len(assets) == 0 {
		result.Status = "failed"
		result.Error = "the build produced no usable file"
		respondFailedDocumentBuild(c, run, build, result, settings.MaxAttempts, code)
		return
	}

	artifactsJson, _ := common.Marshal(result.Artifacts)
	_ = model.UpdatePlaygroundDocumentBuild(build.Id, map[string]any{
		"status": model.PlaygroundDocumentBuildCompleted, "artifacts_json": string(artifactsJson),
		"exit_code": result.ExitCode, "duration_ms": result.DurationMs, "error_message": "",
	})
	_ = model.UpdatePlaygroundChatToolRunCAS(run.Id, run.UserId, "executing", map[string]any{"status": "completed"})

	common.ApiSuccess(c, gin.H{
		"status":     "completed",
		"build_id":   build.Id,
		"attempt":    build.Attempt,
		"assets":     assets,
		"logs":       result.Logs.Stdout,
		"unverified": documentUnverifiedNames(result.Artifacts),
	})
}

// ReleasePlaygroundDocumentSandbox drops a conversation's warm container. Idle containers bill
// for memory, so leaving a conversation should stop paying for it rather than waiting out the
// sleep timer.
func ReleasePlaygroundDocumentSandbox(c *gin.Context) {
	userId := c.GetInt("id")
	var body struct {
		ConversationId int `json:"conversation_id"`
	}
	if err := common.DecodeJson(c.Request.Body, &body); err != nil || body.ConversationId <= 0 {
		common.ApiErrorMsg(c, "invalid conversation")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	if err := service.DestroyPlaygroundDocumentSandbox(ctx, service.PlaygroundDocumentSandboxKey(userId, body.ConversationId)); err != nil {
		// The container expires on its own, so a failure here costs money rather than
		// correctness and is not worth failing the user's navigation over.
		common.SysError("release document sandbox failed: " + err.Error())
	}
	common.ApiSuccess(c, gin.H{"released": true})
}

func respondFailedDocumentBuild(c *gin.Context, run *model.PlaygroundChatToolRun, build *model.PlaygroundDocumentBuild, result *service.DocumentBuildResult, maxAttempts int, code string) {
	failure := strings.TrimSpace(result.Logs.Stderr)
	if failure == "" {
		failure = result.Error
	}
	if len(failure) > 8000 {
		failure = failure[len(failure)-8000:]
	}
	artifactsJson, _ := common.Marshal(result.Artifacts)
	_ = model.UpdatePlaygroundDocumentBuild(build.Id, map[string]any{
		"status": model.PlaygroundDocumentBuildFailed, "artifacts_json": string(artifactsJson),
		"stderr_tail": failure, "exit_code": result.ExitCode, "duration_ms": result.DurationMs,
		"error_message": result.Error,
	})

	canRetry := build.Attempt < maxAttempts
	if !canRetry {
		_ = model.UpdatePlaygroundChatToolRunCAS(run.Id, run.UserId, "executing", map[string]any{
			"status": "failed", "error_message": result.Error,
		})
	}
	response := gin.H{
		"status":    "failed",
		"build_id":  build.Id,
		"attempt":   build.Attempt,
		"error":     result.Error,
		"logs":      result.Logs.Stdout,
		"can_retry": canRetry,
	}
	if canRetry {
		var state documentRunState
		_ = common.UnmarshalJsonStr(run.ArgumentsJson, &state)
		response["retry_prompt"] = service.BuildPlaygroundDocumentSystemPrompt(service.PlaygroundDocumentPrompt{
			Inputs:       documentInputNamesForState(run.UserId, state),
			Previous:     state.PreviousNames,
			PreviousCode: code,
			FailureLog:   failure,
			Formats:      state.Formats,
			HTMLPdf:      system_setting.GetDocumentBuilderSettings().BrowserPdfEnabled,
		})
	}
	common.ApiSuccess(c, response)
}

func persistDocumentArtifact(userId int, artifact service.DocumentArtifact) (*model.PlaygroundAsset, error) {
	kind, mime := service.PlaygroundDocumentArtifactKind(artifact.Name)
	if artifact.Mime != "" && artifact.Mime != "application/octet-stream" && mime == "application/octet-stream" {
		mime = artifact.Mime
	}
	asset := &model.PlaygroundAsset{
		UserId:     userId,
		Kind:       kind,
		Source:     model.PlaygroundAssetSourceLibrary,
		Name:       path.Base(artifact.Name),
		StorageKey: artifact.R2Key,
		Backend:    storage.Default().Backend(),
		Mime:       mime,
		Size:       artifact.Bytes,
	}
	if err := model.CreatePlaygroundAsset(asset); err != nil {
		return nil, err
	}
	asset.URL = playgroundAssetContentURL(asset.Id)
	return asset, nil
}

// documentInputName is what the build script will see on disk. The stored key is a UUID, which
// tells the model nothing, so the original filename is used instead.
func documentInputName(asset *model.PlaygroundAsset) string {
	name := path.Base(strings.TrimSpace(asset.Name))
	if name == "" || name == "." || name == "/" {
		name = path.Base(asset.StorageKey)
	}
	safe := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '_', r == '-':
			return r
		default:
			return '_'
		}
	}, name)
	if safe == "" || strings.HasPrefix(safe, ".") {
		safe = "input" + safe
	}
	return safe
}

func documentInputNamesForState(userId int, state documentRunState) []string {
	names := make([]string, 0, len(state.AssetIds))
	for _, assetId := range state.AssetIds {
		asset, err := model.GetPlaygroundAsset(assetId, userId)
		if err != nil {
			continue
		}
		names = append(names, documentInputName(asset))
	}
	return names
}

func documentUnverifiedNames(artifacts []service.DocumentArtifact) []string {
	names := []string{}
	for _, artifact := range artifacts {
		if kind, _ := service.PlaygroundDocumentArtifactKind(artifact.Name); kind == "document" && !artifact.Verified {
			names = append(names, artifact.Name)
		}
	}
	return names
}

func saveDocumentRunState(run *model.PlaygroundChatToolRun, state documentRunState) error {
	var arguments map[string]any
	_ = common.UnmarshalJsonStr(run.ArgumentsJson, &arguments)
	if arguments == nil {
		arguments = map[string]any{}
	}
	encoded, err := common.Marshal(state)
	if err != nil {
		return err
	}
	var merged map[string]any
	if err := common.Unmarshal(encoded, &merged); err != nil {
		return err
	}
	for key, value := range merged {
		arguments[key] = value
	}
	updated, err := common.Marshal(arguments)
	if err != nil {
		return err
	}
	run.ArgumentsJson = string(updated)
	return model.UpdatePlaygroundChatToolRunCAS(run.Id, run.UserId, run.Status, map[string]any{"arguments_json": run.ArgumentsJson})
}

func ownedDocumentRun(c *gin.Context) *model.PlaygroundChatToolRun {
	run := ownedToolRun(c)
	if run == nil {
		return nil
	}
	if run.Action != service.PlaygroundToolDocument {
		c.Status(http.StatusNotFound)
		return nil
	}
	return run
}
