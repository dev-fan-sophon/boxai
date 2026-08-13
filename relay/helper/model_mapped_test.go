package helper

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	relayconstant "github.com/dev-fan-sophon/boxai/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesCompactUsesStandardModelMapping(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(nil)
	ctx.Set("model_mapping", `{"gpt-client":"gpt-upstream"}`)
	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeResponsesCompact,
		OriginModelName: "gpt-client",
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gpt-client",
		},
	}
	request := &dto.OpenAIResponsesRequest{Model: "gpt-client"}

	err := ModelMappedHelper(ctx, info, request)

	require.NoError(t, err)
	assert.Equal(t, "gpt-client", info.OriginModelName)
	assert.Equal(t, "gpt-upstream", info.UpstreamModelName)
	assert.Equal(t, "gpt-upstream", request.Model)
}
