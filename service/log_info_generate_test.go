package service_test

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/relay/channel/openai"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateTextOtherInfoLogsSuffixResolvedReasoningEffort(t *testing.T) {
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	request := &dto.GeneralOpenAIRequest{
		Model:           "customer-model",
		ReasoningEffort: "low",
	}
	info := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatOpenAI,
		OriginModelName: "customer-model",
		ReasoningEffort: request.ReasoningEffort,
		StartTime:       time.Now(),
		FirstResponseTime: time.Now().Add(
			50 * time.Millisecond,
		),
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			UpstreamModelName: "gpt-5.4-high",
		},
	}

	converted, err := (&openai.Adaptor{}).ConvertOpenAIRequest(ctx, info, request)
	require.NoError(t, err)
	relaycommon.AppendRequestConversionFromRequest(info, converted)
	other := service.GenerateTextOtherInfo(ctx, info, 1, 1, 1, 0, 1, 0, 1)

	assert.Equal(t, "high", info.ReasoningEffort)
	assert.Equal(t, "high", other["reasoning_effort"])
}
