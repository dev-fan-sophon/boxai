package gemini

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTrackGeminiCompletedToolsDeduplicatesStreamSnapshots(t *testing.T) {
	operation_setting.LoadToolPricesFromJSONString(`{"paid_lookup":3}`)
	t.Cleanup(func() { operation_setting.LoadToolPricesFromJSONString(`{}`) })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{OriginModelName: "gemini-test"}
	seen := make(map[string]struct{})
	response := &dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
		GroundingMetadata: &dto.GeminiGroundingMetadata{WebSearchQueries: []string{"query"}},
		Content: dto.GeminiChatContent{Parts: []dto.GeminiPart{
			{FunctionCall: &dto.FunctionCall{FunctionName: "paid_lookup", Arguments: map[string]interface{}{"q": "one"}}},
			{FunctionCall: &dto.FunctionCall{FunctionName: "paid_lookup", Arguments: map[string]interface{}{"q": "two"}}},
		}},
	}}}

	trackGeminiCompletedTools(c, info, response, seen)
	trackGeminiCompletedTools(c, info, response, seen)

	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolGoogleSearch].CallCount)
	assert.Equal(t, 2, info.ResponsesUsageInfo.BuiltInTools["paid_lookup"].CallCount)
	assert.Equal(t, 1, info.ResponsesUsageInfo.BuiltInTools[relaycommon.GoogleSearchGroundedPromptTool].CallCount)
}

func TestGeminiGroundingCountsUniqueQueriesAcrossFrames(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{OriginModelName: "gemini-3-pro-preview"}
	seen := make(map[string]struct{})
	frame := func(web []string, image []string) *dto.GeminiChatResponse {
		return &dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
			GroundingMetadata: &dto.GeminiGroundingMetadata{WebSearchQueries: web, ImageSearchQueries: image},
		}}}
	}

	trackGeminiCompletedTools(c, info, frame([]string{"weather hanoi", " ", ""}, nil), seen)
	trackGeminiCompletedTools(c, info, frame([]string{"weather hanoi", "pho recipe"}, []string{"ha long bay"}), seen)

	tools := info.ResponsesUsageInfo.BuiltInTools
	assert.Equal(t, 3, tools[dto.BuildInToolGoogleSearch].CallCount)
	assert.Equal(t, 1, tools[relaycommon.GoogleSearchGroundedPromptTool].CallCount)
}

func TestGeminiGroundingWithoutQueriesBillsNothing(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{OriginModelName: "gemini-2.5-flash"}
	response := &dto.GeminiChatResponse{Candidates: []dto.GeminiChatCandidate{{
		GroundingMetadata: &dto.GeminiGroundingMetadata{WebSearchQueries: []string{"  "}},
	}}}
	trackGeminiCompletedTools(c, info, response, make(map[string]struct{}))
	assert.Nil(t, info.ResponsesUsageInfo)
}
