package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service/relayconvert"
	"github.com/dev-fan-sophon/boxai/setting/config"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/dev-fan-sophon/boxai/setting/reasoning"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func modelRequestContext(t *testing.T, path string, body string) *gin.Context {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	t.Cleanup(func() { common.CleanupBodyStorage(ctx) })
	return ctx
}

func TestModelModifierRoutesOnBaseModel(t *testing.T) {
	ctx := modelRequestContext(t, "/v1/chat/completions", `{"model":"gpt-5@effort:high"}`)

	request, _, err := getModelRequest(ctx)

	require.NoError(t, err)
	assert.Equal(t, "gpt-5", request.Model, "channel selection, token model limits and group checks use the base model")
	modifiers, ok := common.GetContextKeyType[reasoning.ModelModifiers](ctx, constant.ContextKeyModelModifiers)
	require.True(t, ok)
	assert.Equal(t, reasoning.ModelModifiers{Effort: "high", Thinking: "on"}, modifiers)
}

func TestModelModifierInvalidValueIsRejected(t *testing.T) {
	ctx := modelRequestContext(t, "/v1/chat/completions", `{"model":"gpt-5@effort:turbo"}`)
	_, _, err := getModelRequest(ctx)
	require.Error(t, err)
}

func TestLegacySuffixModelIsNotRewritten(t *testing.T) {
	for _, model := range []string{"gpt-5-high", "claude-opus-4-7-thinking", "deepseek-v4-pro-max", "claude-3-5-sonnet@20240620"} {
		ctx := modelRequestContext(t, "/v1/chat/completions", `{"model":"`+model+`"}`)
		request, _, err := getModelRequest(ctx)
		require.NoError(t, err)
		assert.Equal(t, model, request.Model)
		_, ok := common.GetContextKey(ctx, constant.ContextKeyModelModifiers)
		assert.False(t, ok, model)
	}
}

func TestThinkingBlacklistExemptsModifierSyntax(t *testing.T) {
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(saved)) })
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"global.thinking_model_blacklist": `["vendor-model@effort:fast"]`,
	}))

	ctx := modelRequestContext(t, "/v1/chat/completions", `{"model":"vendor-model@effort:fast"}`)
	request, _, err := getModelRequest(ctx)
	require.NoError(t, err)
	assert.Equal(t, "vendor-model@effort:fast", request.Model)
}

// A model@effort name is priced exactly like its base model: the relay's
// origin model comes from the distributor's routing name, not the body.
func TestModelModifierPricesOnBaseModel(t *testing.T) {
	savedPrices := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(savedPrices)) })
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"modifier-base-model":0.5}`))

	ctx := modelRequestContext(t, "/v1/chat/completions", `{"model":"modifier-base-model@effort:max"}`)
	modelRequest, _, err := getModelRequest(ctx)
	require.NoError(t, err)
	common.SetContextKey(ctx, constant.ContextKeyOriginalModel, modelRequest.Model)
	ctx.Set("group", "default")

	request := &dto.GeneralOpenAIRequest{Model: "modifier-base-model@effort:max"}
	require.NoError(t, relayconvert.ApplyModelModifiers(ctx, request))
	assert.Equal(t, "modifier-base-model", request.Model)
	assert.Equal(t, "max", request.ReasoningEffort, "effort passes through without remapping")

	info := relaycommon.GenRelayInfoOpenAI(ctx, request)
	assert.Equal(t, "modifier-base-model", info.OriginModelName)
	assert.Equal(t, "max", info.ReasoningEffort)
	priceData, err := helper.ModelPriceHelper(ctx, info, 10, &types.TokenCountMeta{})
	require.NoError(t, err)
	assert.True(t, priceData.UsePrice)
	assert.Equal(t, 0.5, priceData.ModelPrice)
}

func TestDeepSeekToolsRoutesUseEndpointModelName(t *testing.T) {
	for path, want := range map[string]string{
		"/v1/tools/search": constant.DeepSeekSearchModel,
		"/v1/tools/fetch":  constant.DeepSeekFetchModel,
	} {
		ctx := modelRequestContext(t, path, `{"query":"hanoi weather","model":"deepseek-flash"}`)
		request, shouldSelect, err := getModelRequest(ctx)
		require.NoError(t, err)
		assert.True(t, shouldSelect)
		assert.Equal(t, want, request.Model, "a body model must not choose the billing model")
	}
}
