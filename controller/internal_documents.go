package controller

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"
)

// Internal document-build API for the boxai-chat service. The chat service
// owns run orchestration (authoring loop, retries, run records); the gateway
// keeps what is infrastructure: the sandbox, the artifact storage, the build
// audit rows, and the hard resource limits. Unlike the public run-bound
// endpoints there is no execution token: the caller is a trusted sibling
// authenticated by InternalServiceAuth acting as a user.

// InternalPrepareDocumentBuild returns the authoring system prompt plus the
// continuation state (previous artifacts, last code) for a conversation. The
// chat service passes that state back verbatim on the build call.
func InternalPrepareDocumentBuild(c *gin.Context) {
	userId := c.GetInt("id")
	var body struct {
		RequestText    string `json:"request_text"`
		ConversationId int    `json:"conversation_id"`
		AssetIds       []int  `json:"asset_ids"`
	}
	if err := common.DecodeJson(c.Request.Body, &body); err != nil {
		common.ApiErrorMsg(c, "invalid request")
		return
	}
	if !service.DocumentBuilderAvailable(c.GetString("group")) {
		common.ApiErrorMsg(c, "document generation is not available")
		return
	}
	if len(body.AssetIds) > 8 {
		common.ApiErrorMsg(c, "too many attachments")
		return
	}

	settings := system_setting.GetDocumentBuilderSettings()
	prompt := service.PlaygroundDocumentPrompt{
		Formats: service.DetectPlaygroundDocumentFormats(body.RequestText),
		HTMLPdf: settings.BrowserPdfEnabled,
	}
	for _, assetId := range body.AssetIds {
		asset, err := model.GetPlaygroundAsset(assetId, userId)
		if err != nil {
			common.ApiErrorMsg(c, "attachment is not owned by this user")
			return
		}
		prompt.Inputs = append(prompt.Inputs, documentInputName(asset))
	}

	previousKeys := []string{}
	previousNames := []string{}
	lastCode := ""
	if body.ConversationId > 0 {
		previous, err := model.LatestCompletedPlaygroundDocumentBuild(userId, body.ConversationId)
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
				previousKeys = append(previousKeys, artifact.R2Key)
				previousNames = append(previousNames, artifact.Name)
				prompt.Previous = append(prompt.Previous, artifact.Name)
			}
			lastCode = previous.Code
		}
	}

	common.ApiSuccess(c, gin.H{
		"system_prompt":  service.BuildPlaygroundDocumentSystemPrompt(prompt),
		"formats":        prompt.Formats,
		"inputs":         prompt.Inputs,
		"previous":       prompt.Previous,
		"previous_keys":  previousKeys,
		"previous_names": previousNames,
		"last_code":      lastCode,
		"max_attempts":   settings.MaxAttempts,
	})
}

// InternalBuildDocument runs one model-authored script in the sandbox. A
// script that fails is a normal outcome carrying the corrected prompt for the
// next attempt; only a request that never reached a verdict is an error.
func InternalBuildDocument(c *gin.Context) {
	userId := c.GetInt("id")
	var body struct {
		ExternalRunId  string   `json:"external_run_id"`
		ConversationId int      `json:"conversation_id"`
		AssetIds       []int    `json:"asset_ids"`
		Formats        []string `json:"formats"`
		PreviousKeys   []string `json:"previous_keys"`
		PreviousNames  []string `json:"previous_names"`
		Code           string   `json:"code"`
		ChatModel      string   `json:"chat_model"`
	}
	if err := common.DecodeJson(c.Request.Body, &body); err != nil {
		common.ApiErrorMsg(c, "invalid request")
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
	if body.ExternalRunId == "" || len(body.ExternalRunId) > 64 {
		common.ApiErrorMsg(c, "invalid run reference")
		return
	}
	if len(body.PreviousKeys) != len(body.PreviousNames) {
		common.ApiErrorMsg(c, "invalid previous artifacts")
		return
	}
	if !service.DocumentBuilderAvailable(c.GetString("group")) {
		common.ApiErrorMsg(c, "document generation is not available")
		return
	}

	settings := system_setting.GetDocumentBuilderSettings()
	attempts, err := model.CountPlaygroundDocumentBuildAttemptsByExternalRun(body.ExternalRunId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if int(attempts) >= settings.MaxAttempts {
		common.ApiErrorMsg(c, "this document has used all of its build attempts")
		return
	}

	release, err := service.AcquireDocumentBuildSlot(userId, settings.MaxConcurrentPerUser,
		time.Duration(settings.WallClockSeconds+60)*time.Second)
	if err != nil {
		common.ApiErrorMsg(c, "another document is still building")
		return
	}
	defer release()

	jobId := uuid.NewString()
	build := &model.PlaygroundDocumentBuild{
		UserId:         userId,
		ExternalRunId:  body.ExternalRunId,
		ConversationId: body.ConversationId,
		SandboxKey:     service.PlaygroundDocumentSandboxKey(userId, body.ConversationId),
		Status:         model.PlaygroundDocumentBuildBuilding,
		Attempt:        int(attempts) + 1,
		ChatModel:      body.ChatModel,
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
		ArtifactPrefix: service.PlaygroundDocumentArtifactPrefix(userId, jobId),
	}
	inputNames := make([]string, 0, len(body.AssetIds))
	for _, assetId := range body.AssetIds {
		asset, assetErr := model.GetPlaygroundAsset(assetId, userId)
		if assetErr != nil {
			continue
		}
		name := documentInputName(asset)
		inputNames = append(inputNames, name)
		request.Inputs = append(request.Inputs, service.DocumentBuildFile{Path: name, R2Key: asset.StorageKey})
	}
	for i, key := range body.PreviousKeys {
		request.Previous = append(request.Previous, service.DocumentBuildFile{Path: body.PreviousNames[i], R2Key: key})
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(settings.WallClockSeconds+45)*time.Second)
	defer cancel()
	result, err := service.RunPlaygroundDocumentBuild(ctx, request)
	if err != nil {
		_ = model.UpdatePlaygroundDocumentBuild(build.Id, map[string]any{
			"status": model.PlaygroundDocumentBuildFailed, "error_message": err.Error(), "exit_code": -1,
		})
		common.SysError(fmt.Sprintf("internal document build %d transport failure: %s", build.Id, err.Error()))
		common.ApiErrorMsg(c, "the document service is unavailable, please try again")
		return
	}

	if result.Status != "completed" {
		respondInternalFailedBuild(c, build, result, settings.MaxAttempts, code, inputNames, body.Formats, body.PreviousNames)
		return
	}

	assets := make([]*model.PlaygroundAsset, 0, len(result.Artifacts))
	for _, artifact := range result.Artifacts {
		asset, assetErr := persistDocumentArtifact(userId, artifact)
		if assetErr != nil {
			common.SysError(fmt.Sprintf("internal document build %d could not record %s: %s", build.Id, artifact.Name, assetErr.Error()))
			continue
		}
		assets = append(assets, asset)
	}
	if len(assets) == 0 {
		result.Status = "failed"
		result.Error = "the build produced no usable file"
		respondInternalFailedBuild(c, build, result, settings.MaxAttempts, code, inputNames, body.Formats, body.PreviousNames)
		return
	}

	artifactsJson, _ := common.Marshal(result.Artifacts)
	_ = model.UpdatePlaygroundDocumentBuild(build.Id, map[string]any{
		"status": model.PlaygroundDocumentBuildCompleted, "artifacts_json": string(artifactsJson),
		"exit_code": result.ExitCode, "duration_ms": result.DurationMs, "error_message": "",
	})
	common.ApiSuccess(c, gin.H{
		"status":     "completed",
		"build_id":   build.Id,
		"attempt":    build.Attempt,
		"assets":     assets,
		"logs":       result.Logs.Stdout,
		"unverified": documentUnverifiedNames(result.Artifacts),
	})
}

func respondInternalFailedBuild(c *gin.Context, build *model.PlaygroundDocumentBuild, result *service.DocumentBuildResult, maxAttempts int, code string, inputs []string, formats []string, previousNames []string) {
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
	response := gin.H{
		"status":    "failed",
		"build_id":  build.Id,
		"attempt":   build.Attempt,
		"error":     result.Error,
		"logs":      result.Logs.Stdout,
		"can_retry": canRetry,
	}
	if canRetry {
		response["retry_prompt"] = service.BuildPlaygroundDocumentSystemPrompt(service.PlaygroundDocumentPrompt{
			Inputs:       inputs,
			Previous:     previousNames,
			PreviousCode: code,
			FailureLog:   failure,
			Formats:      formats,
			HTMLPdf:      system_setting.GetDocumentBuilderSettings().BrowserPdfEnabled,
		})
	}
	common.ApiSuccess(c, response)
}
