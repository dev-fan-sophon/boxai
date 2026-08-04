package controller

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/middleware"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"
)

// Connect MCP is a Streamable HTTP endpoint at /mcp. Coding agents (Claude Code,
// Codex, …) reach BoxAI image/video generation through tools rather than by
// putting media models into their chat default. Auth is the same sk- relay key
// Connect already writes into client configs.

const (
	connectMCPProtocolVersion = "2025-03-26"
	connectMCPServerName      = "boxai-media"
	connectMCPServerVersion   = "1.0.0"

	connectMCPToolListModels     = "list_media_models"
	connectMCPToolGenerateImage  = "generate_image"
	connectMCPToolGenerateVideo  = "generate_video"
	connectMCPToolGetVideoStatus = "get_video_status"
)

type mcpJSONRPC struct {
	JSONRPC string         `json:"jsonrpc"`
	ID      any            `json:"id,omitempty"`
	Method  string         `json:"method,omitempty"`
	Params  map[string]any `json:"params,omitempty"`
	Result  any            `json:"result,omitempty"`
	Error   *mcpRPCError   `json:"error,omitempty"`
}

type mcpRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// HandleConnectMCP serves the BoxAI media MCP endpoint (Streamable HTTP).
//
// Stateless JSON responses are enough for tool discovery and short tool calls;
// long-running video work returns a task id and is polled via get_video_status.
func HandleConnectMCP(c *gin.Context) {
	switch c.Request.Method {
	case http.MethodPost:
		handleConnectMCPPost(c)
	case http.MethodGet:
		// No server-push stream; clients that only support listening may 405.
		c.Header("Allow", "POST, DELETE")
		c.AbortWithStatus(http.StatusMethodNotAllowed)
	case http.MethodDelete:
		// No server-side session to tear down.
		c.AbortWithStatus(http.StatusMethodNotAllowed)
	default:
		c.Header("Allow", "POST, DELETE")
		c.AbortWithStatus(http.StatusMethodNotAllowed)
	}
}

func handleConnectMCPPost(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		writeMCPHTTPError(c, http.StatusBadRequest, -32700, "failed to read body")
		return
	}
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		writeMCPHTTPError(c, http.StatusBadRequest, -32700, "empty body")
		return
	}

	// Batch arrays are rare for coding clients; reject clearly rather than
	// half-implementing multi-response framing.
	if body[0] == '[' {
		writeMCPHTTPError(c, http.StatusBadRequest, -32600, "JSON-RPC batches are not supported")
		return
	}

	var msg mcpJSONRPC
	if err := common.Unmarshal(body, &msg); err != nil {
		writeMCPHTTPError(c, http.StatusBadRequest, -32700, "parse error")
		return
	}
	if msg.JSONRPC != "" && msg.JSONRPC != "2.0" {
		writeMCPResponse(c, mcpErrorResult(msg.ID, -32600, "jsonrpc must be \"2.0\""))
		return
	}

	// Notifications (no id) are acknowledged with 202 and no body.
	if msg.ID == nil || isJSONNull(msg.ID) {
		c.AbortWithStatus(http.StatusAccepted)
		return
	}

	if strings.TrimSpace(msg.Method) == "" {
		writeMCPResponse(c, mcpErrorResult(msg.ID, -32600, "method is required"))
		return
	}

	result, rpcErr := dispatchConnectMCP(c, msg.Method, msg.Params)
	if rpcErr != nil {
		writeMCPResponse(c, mcpJSONRPC{
			JSONRPC: "2.0",
			ID:      msg.ID,
			Error:   rpcErr,
		})
		return
	}
	writeMCPResponse(c, mcpJSONRPC{
		JSONRPC: "2.0",
		ID:      msg.ID,
		Result:  result,
	})
}

func dispatchConnectMCP(c *gin.Context, method string, params map[string]any) (any, *mcpRPCError) {
	switch method {
	case "initialize":
		return map[string]any{
			"protocolVersion": connectMCPProtocolVersion,
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    connectMCPServerName,
				"version": connectMCPServerVersion,
			},
			"instructions": "BoxAI media tools. Use list_media_models first, then generate_image or generate_video. Video generation is async: poll get_video_status with the returned task id until completed.",
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": connectMCPTools()}, nil
	case "tools/call":
		return callConnectMCPTool(c, params)
	case "resources/list":
		return map[string]any{"resources": []any{}}, nil
	case "prompts/list":
		return map[string]any{"prompts": []any{}}, nil
	default:
		return nil, &mcpRPCError{Code: -32601, Message: "method not found: " + method}
	}
}

func connectMCPTools() []map[string]any {
	return []map[string]any{
		{
			"name":        connectMCPToolListModels,
			"description": "List image and video models this BoxAI account may use, plus the recommended defaults.",
			"inputSchema": map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			"name":        connectMCPToolGenerateImage,
			"description": "Generate an image with a BoxAI image model. Returns image URLs or base64 payloads from the relay.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"prompt": map[string]any{"type": "string", "description": "Image description."},
					"model":  map[string]any{"type": "string", "description": "Image model id. Omit to use the account default."},
					"n":      map[string]any{"type": "integer", "description": "Number of images (1-128).", "minimum": 1, "maximum": dto.MaxImageN},
					"size":   map[string]any{"type": "string", "description": "Optional size, e.g. 1024x1024."},
					"quality": map[string]any{
						"type":        "string",
						"description": "Optional quality hint when the model supports it.",
					},
				},
				"required": []string{"prompt"},
			},
		},
		{
			"name":        connectMCPToolGenerateVideo,
			"description": "Start a text-to-video generation job. Returns a task id; poll get_video_status until completed.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"prompt":   map[string]any{"type": "string", "description": "Video description."},
					"model":    map[string]any{"type": "string", "description": "Video model id. Omit to use the account default."},
					"seconds":  map[string]any{"type": "integer", "description": "Duration in seconds (1-3600).", "minimum": 1, "maximum": relaycommon.MaxTaskDurationSeconds},
					"size":     map[string]any{"type": "string", "description": "Optional frame size, e.g. 1280x720."},
					"metadata": map[string]any{"type": "object", "description": "Optional vendor-specific parameters."},
				},
				"required": []string{"prompt"},
			},
		},
		{
			"name":        connectMCPToolGetVideoStatus,
			"description": "Fetch status for a video task previously returned by generate_video.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"task_id": map[string]any{"type": "string", "description": "Task id from generate_video."},
				},
				"required": []string{"task_id"},
			},
		},
	}
}

func callConnectMCPTool(c *gin.Context, params map[string]any) (any, *mcpRPCError) {
	if params == nil {
		return nil, &mcpRPCError{Code: -32602, Message: "params are required"}
	}
	name, _ := params["name"].(string)
	name = strings.TrimSpace(name)
	args, _ := params["arguments"].(map[string]any)
	if args == nil {
		args = map[string]any{}
	}

	switch name {
	case connectMCPToolListModels:
		return mcpToolResultJSON(connectMediaCatalog(c))
	case connectMCPToolGenerateImage:
		return mcpGenerateImage(c, args)
	case connectMCPToolGenerateVideo:
		return mcpGenerateVideo(c, args)
	case connectMCPToolGetVideoStatus:
		return mcpGetVideoStatus(c, args)
	default:
		return mcpToolResultError("unknown tool: " + name), nil
	}
}

func connectMediaCatalog(c *gin.Context) map[string]any {
	modelNames, _, err := accountModelNames(c)
	if err != nil {
		return map[string]any{
			"image_models":  []string{},
			"video_models":  []string{},
			"default_image": "",
			"default_video": "",
			"error":         "could not resolve account models",
		}
	}
	imageModels, videoModels := partitionMediaModels(modelNames)
	return map[string]any{
		"image_models":  imageModels,
		"video_models":  videoModels,
		"default_image": selectToolModel(imageModels, service.PlaygroundToolImage),
		"default_video": selectToolModel(videoModels, service.PlaygroundToolVideo),
	}
}

func mcpGenerateImage(c *gin.Context, args map[string]any) (any, *mcpRPCError) {
	prompt := strings.TrimSpace(anyString(args["prompt"]))
	if prompt == "" {
		return mcpToolResultError("prompt is required"), nil
	}
	catalog := connectMediaCatalog(c)
	imageModels, _ := catalog["image_models"].([]string)
	modelName := strings.TrimSpace(anyString(args["model"]))
	if modelName == "" {
		modelName, _ = catalog["default_image"].(string)
	}
	if modelName == "" {
		return mcpToolResultError("no image model is available for this account"), nil
	}
	if len(imageModels) > 0 && !stringInList(imageModels, modelName) {
		return mcpToolResultError(fmt.Sprintf("model %q is not an image model this account may use", modelName)), nil
	}

	n := anyUint(args["n"], 1)
	if n == 0 {
		n = 1
	}
	if n > dto.MaxImageN {
		return mcpToolResultError(fmt.Sprintf("n must be between 1 and %d", dto.MaxImageN)), nil
	}

	body := map[string]any{
		"model":  modelName,
		"prompt": prompt,
		"n":      n,
	}
	if size := strings.TrimSpace(anyString(args["size"])); size != "" {
		body["size"] = size
	}
	if quality := strings.TrimSpace(anyString(args["quality"])); quality != "" {
		body["quality"] = quality
	}

	status, respBody, err := relayThroughToken(c, http.MethodPost, "/v1/images/generations", body, types.RelayFormatOpenAIImage, false)
	if err != nil {
		return mcpToolResultError(err.Error()), nil
	}
	if status >= 400 {
		return mcpToolResultError(fmt.Sprintf("image generation failed (HTTP %d): %s", status, truncateForMCP(string(respBody), 2000))), nil
	}
	return mcpToolResultJSON(map[string]any{
		"model":    modelName,
		"http":     status,
		"response": rawJSONOrString(respBody),
	})
}

func mcpGenerateVideo(c *gin.Context, args map[string]any) (any, *mcpRPCError) {
	prompt := strings.TrimSpace(anyString(args["prompt"]))
	if prompt == "" {
		return mcpToolResultError("prompt is required"), nil
	}
	catalog := connectMediaCatalog(c)
	videoModels, _ := catalog["video_models"].([]string)
	modelName := strings.TrimSpace(anyString(args["model"]))
	if modelName == "" {
		modelName, _ = catalog["default_video"].(string)
	}
	if modelName == "" {
		return mcpToolResultError("no video model is available for this account"), nil
	}
	if len(videoModels) > 0 && !stringInList(videoModels, modelName) {
		return mcpToolResultError(fmt.Sprintf("model %q is not a video model this account may use", modelName)), nil
	}

	body := map[string]any{
		"model":  modelName,
		"prompt": prompt,
	}
	if seconds := anyInt(args["seconds"], 0); seconds > 0 {
		if seconds > relaycommon.MaxTaskDurationSeconds {
			return mcpToolResultError(fmt.Sprintf("seconds must be between 1 and %d", relaycommon.MaxTaskDurationSeconds)), nil
		}
		body["seconds"] = fmt.Sprintf("%d", seconds)
	}
	if size := strings.TrimSpace(anyString(args["size"])); size != "" {
		body["size"] = size
	}
	if metadata, ok := args["metadata"].(map[string]any); ok && len(metadata) > 0 {
		body["metadata"] = metadata
	}

	status, respBody, err := relayThroughToken(c, http.MethodPost, "/v1/videos", body, types.RelayFormatTask, true)
	if err != nil {
		return mcpToolResultError(err.Error()), nil
	}
	if status >= 400 {
		return mcpToolResultError(fmt.Sprintf("video generation failed (HTTP %d): %s", status, truncateForMCP(string(respBody), 2000))), nil
	}
	return mcpToolResultJSON(map[string]any{
		"model":    modelName,
		"http":     status,
		"response": rawJSONOrString(respBody),
		"note":     "Poll get_video_status with the task id until status is completed or failed.",
	})
}

func mcpGetVideoStatus(c *gin.Context, args map[string]any) (any, *mcpRPCError) {
	taskID := strings.TrimSpace(anyString(args["task_id"]))
	if taskID == "" {
		// Accept OpenAI-style "id" as an alias.
		taskID = strings.TrimSpace(anyString(args["id"]))
	}
	if taskID == "" {
		return mcpToolResultError("task_id is required"), nil
	}
	// Path-safe: task ids are opaque tokens from our own relay, not free-form paths.
	if strings.ContainsAny(taskID, "/\\?&#") {
		return mcpToolResultError("invalid task_id"), nil
	}

	status, respBody, err := relayThroughToken(
		c,
		http.MethodGet,
		"/v1/videos/"+taskID,
		nil,
		types.RelayFormatTask,
		true,
		gin.Param{Key: "task_id", Value: taskID},
	)
	if err != nil {
		return mcpToolResultError(err.Error()), nil
	}
	if status >= 400 {
		return mcpToolResultError(fmt.Sprintf("video status failed (HTTP %d): %s", status, truncateForMCP(string(respBody), 2000))), nil
	}
	return mcpToolResultJSON(map[string]any{
		"task_id":  taskID,
		"http":     status,
		"response": rawJSONOrString(respBody),
	})
}

// relayThroughToken runs the normal token-authenticated relay pipeline on a
// synthetic request, reusing the caller's already-validated auth context so
// billing, channel selection and model limits stay identical to a direct
// /v1 call with the same sk- key.
func relayThroughToken(
	parent *gin.Context,
	method, path string,
	body map[string]any,
	relayFormat types.RelayFormat,
	task bool,
	params ...gin.Param,
) (int, []byte, error) {
	var bodyReader io.Reader
	if body != nil {
		raw, err := common.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("encode request: %w", err)
		}
		bodyReader = bytes.NewReader(raw)
	} else {
		bodyReader = http.NoBody
	}

	req, err := http.NewRequest(method, path, bodyReader)
	if err != nil {
		return 0, nil, fmt.Errorf("could not build internal request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if auth := parent.GetHeader("Authorization"); auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if reqID := parent.GetString(common.RequestIdKey); reqID != "" {
		req.Header.Set("X-Request-Id", reqID)
	} else {
		req.Header.Set("X-Request-Id", uuid.NewString())
	}

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req
	if len(params) > 0 {
		ctx.Params = append(gin.Params{}, params...)
	}
	copyGinKeys(parent, ctx)

	// Distribute selects the upstream channel from the body model / path.
	// It aborts the context on failure and writes the OpenAI error itself.
	middleware.Distribute()(ctx)
	if ctx.IsAborted() {
		return recorder.Code, recorder.Body.Bytes(), nil
	}

	if task {
		if method == http.MethodGet {
			RelayTaskFetch(ctx)
		} else {
			RelayTask(ctx)
		}
	} else {
		Relay(ctx, relayFormat)
	}
	return recorder.Code, recorder.Body.Bytes(), nil
}

func copyGinKeys(src, dst *gin.Context) {
	if src.Keys != nil {
		for key, value := range src.Keys {
			dst.Set(key, value)
		}
	}
}

func writeMCPResponse(c *gin.Context, payload mcpJSONRPC) {
	c.Header("Content-Type", "application/json")
	c.JSON(http.StatusOK, payload)
}

func writeMCPHTTPError(c *gin.Context, httpStatus int, code int, message string) {
	c.Header("Content-Type", "application/json")
	c.JSON(httpStatus, mcpJSONRPC{
		JSONRPC: "2.0",
		Error:   &mcpRPCError{Code: code, Message: message},
	})
}

func mcpErrorResult(id any, code int, message string) mcpJSONRPC {
	return mcpJSONRPC{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &mcpRPCError{Code: code, Message: message},
	}
}

func mcpToolResultJSON(value any) (any, *mcpRPCError) {
	raw, err := common.Marshal(value)
	if err != nil {
		return nil, &mcpRPCError{Code: -32603, Message: "failed to encode tool result"}
	}
	return map[string]any{
		"content": []map[string]any{
			{"type": "text", "text": string(raw)},
		},
		"structuredContent": value,
	}, nil
}

func mcpToolResultError(message string) any {
	return map[string]any{
		"content": []map[string]any{
			{"type": "text", "text": message},
		},
		"isError": true,
	}
}

func rawJSONOrString(body []byte) any {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return map[string]any{}
	}
	var value any
	if err := common.Unmarshal(body, &value); err == nil {
		return value
	}
	return string(body)
}

func truncateForMCP(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func anyString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case fmt.Stringer:
		return t.String()
	case float64:
		// JSON numbers land as float64; task ids are never numeric, but model
		// names shouldn't arrive this way either — stringify defensively.
		return fmt.Sprintf("%v", t)
	case int:
		return fmt.Sprintf("%d", t)
	default:
		return ""
	}
}

func anyInt(v any, fallback int) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case int64:
		return int(t)
	case string:
		var n int
		if _, err := fmt.Sscanf(strings.TrimSpace(t), "%d", &n); err == nil {
			return n
		}
	}
	return fallback
}

func anyUint(v any, fallback uint) uint {
	n := anyInt(v, int(fallback))
	if n < 0 {
		return fallback
	}
	return uint(n)
}

func stringInList(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func isJSONNull(v any) bool {
	return v == nil
}
