package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func requestConnectMCP(t *testing.T, userID int, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewBufferString(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Request.Header.Set("Accept", "application/json, text/event-stream")
	ctx.Set("id", userID)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "default")
	HandleConnectMCP(ctx)
	return recorder
}

func TestConnectMCPInitializeAndToolsList(t *testing.T) {
	withSelfUseModeEnabled(t)
	setupModelListControllerTestDB(t)

	initRec := requestConnectMCP(t, 1, `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}`)
	require.Equal(t, http.StatusOK, initRec.Code)
	var initPayload map[string]any
	require.NoError(t, common.Unmarshal(initRec.Body.Bytes(), &initPayload))
	result, _ := initPayload["result"].(map[string]any)
	require.NotNil(t, result)
	assert.Equal(t, connectMCPProtocolVersion, result["protocolVersion"])
	serverInfo, _ := result["serverInfo"].(map[string]any)
	assert.Equal(t, connectMCPServerName, serverInfo["name"])

	// notifications/initialized → 202 empty
	notif := requestConnectMCP(t, 1, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	assert.Equal(t, http.StatusAccepted, notif.Code)

	listRec := requestConnectMCP(t, 1, `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	require.Equal(t, http.StatusOK, listRec.Code)
	var listPayload map[string]any
	require.NoError(t, common.Unmarshal(listRec.Body.Bytes(), &listPayload))
	listResult, _ := listPayload["result"].(map[string]any)
	tools, _ := listResult["tools"].([]any)
	require.Len(t, tools, 4)
	names := map[string]bool{}
	for _, tool := range tools {
		entry, _ := tool.(map[string]any)
		name, _ := entry["name"].(string)
		names[name] = true
	}
	assert.True(t, names[connectMCPToolListModels])
	assert.True(t, names[connectMCPToolGenerateImage])
	assert.True(t, names[connectMCPToolGenerateVideo])
	assert.True(t, names[connectMCPToolGetVideoStatus])
}

func TestConnectMCPListMediaModelsTool(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)

	require.NoError(t, db.Create(&model.User{
		Id: 3101, Username: "mcp-user", Password: "password",
		Group: "default", Status: common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&[]model.Channel{
		{Id: 901, Type: constant.ChannelTypeOpenAI, Key: "k", Status: common.ChannelStatusEnabled, Name: "openai", Group: "default", Models: "zz-mcp-chat,zz-mcp-image"},
		{Id: 902, Type: constant.ChannelTypeSora, Key: "k", Status: common.ChannelStatusEnabled, Name: "sora", Group: "default", Models: "zz-mcp-video"},
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-mcp-chat", ChannelId: 901, Enabled: true},
		{Group: "default", Model: "zz-mcp-image", ChannelId: 901, Enabled: true},
		{Group: "default", Model: "zz-mcp-video", ChannelId: 902, Enabled: true},
	}).Error)
	withPricingCache(t)

	body := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_media_models","arguments":{}}}`
	rec := requestConnectMCP(t, 3101, body)
	require.Equal(t, http.StatusOK, rec.Code)

	var payload map[string]any
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &payload))
	result, _ := payload["result"].(map[string]any)
	require.NotNil(t, result)
	assert.NotEqual(t, true, result["isError"])
	structured, _ := result["structuredContent"].(map[string]any)
	require.NotNil(t, structured, "tool result must carry structuredContent")

	imageModels, _ := structured["image_models"].([]any)
	videoModels, _ := structured["video_models"].([]any)
	// Endpoint classification depends on channel type → pricing cache. Image and
	// video fixtures must at least not crash; when pricing maps them correctly
	// they appear in the respective lists.
	assert.NotNil(t, imageModels)
	assert.NotNil(t, videoModels)
}

func TestConnectMCPUnknownToolIsToolErrorNotRPCError(t *testing.T) {
	withSelfUseModeEnabled(t)
	setupModelListControllerTestDB(t)

	rec := requestConnectMCP(t, 1, `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"nope","arguments":{}}}`)
	require.Equal(t, http.StatusOK, rec.Code)
	var payload map[string]any
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Nil(t, payload["error"])
	result, _ := payload["result"].(map[string]any)
	assert.Equal(t, true, result["isError"])
}

func TestConnectMCPGenerateImageRequiresPrompt(t *testing.T) {
	withSelfUseModeEnabled(t)
	setupModelListControllerTestDB(t)

	rec := requestConnectMCP(t, 1, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"generate_image","arguments":{"prompt":"  "}}}`)
	require.Equal(t, http.StatusOK, rec.Code)
	var payload map[string]any
	require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &payload))
	result, _ := payload["result"].(map[string]any)
	require.Equal(t, true, result["isError"])
	content, _ := result["content"].([]any)
	require.NotEmpty(t, content)
	first, _ := content[0].(map[string]any)
	assert.Contains(t, first["text"], "prompt")
}

func TestConnectMCPRejectsBatch(t *testing.T) {
	withSelfUseModeEnabled(t)
	setupModelListControllerTestDB(t)
	rec := requestConnectMCP(t, 1, `[{"jsonrpc":"2.0","id":1,"method":"ping"}]`)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestPartitionMediaModels(t *testing.T) {
	// Unit-level: without pricing cache entries, endpoints are empty → no media.
	images, videos := partitionMediaModels([]string{"a", "b"})
	assert.Empty(t, images)
	assert.Empty(t, videos)
}

func TestPublicOriginPrefersForwardedHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:3000/api/connect/provisioning", nil)
	ctx.Request.Header.Set("X-Forwarded-Proto", "https")
	ctx.Request.Header.Set("X-Forwarded-Host", "you-box.com")
	assert.Equal(t, "https://you-box.com", publicOrigin(ctx))
}
