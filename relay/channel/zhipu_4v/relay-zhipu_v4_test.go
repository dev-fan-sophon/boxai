package zhipu_4v

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/stretchr/testify/assert"
)

func TestRequestOpenAI2ZhipuForwardsReasoningEffort(t *testing.T) {
	out := requestOpenAI2Zhipu(dto.GeneralOpenAIRequest{
		Model:           "glm-test",
		Messages:        []dto.Message{{Role: "user", Content: "hi"}},
		ReasoningEffort: "high",
	})
	assert.Equal(t, "high", out.ReasoningEffort)
}
