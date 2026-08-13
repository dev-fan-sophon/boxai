package ali

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestRequestOpenAI2AliPreservesOptionalTopP(t *testing.T) {
	tests := []struct {
		name string
		topP *float64
		want *float64
	}{
		{name: "omitted", topP: nil, want: nil},
		{name: "in range", topP: lo.ToPtr(0.8), want: lo.ToPtr(0.8)},
		{name: "one", topP: lo.ToPtr(1.0), want: lo.ToPtr(0.99)},
		{name: "above one", topP: lo.ToPtr(1.5), want: lo.ToPtr(0.99)},
		{name: "explicit zero", topP: lo.ToPtr(0.0), want: lo.ToPtr(0.01)},
		{name: "below zero", topP: lo.ToPtr(-0.3), want: lo.ToPtr(0.01)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := requestOpenAI2Ali(dto.GeneralOpenAIRequest{
				Model: "qwen-plus",
				TopP:  tt.topP,
			}, "qwen-plus")

			assert.Equal(t, tt.want, got.TopP)
		})
	}
}

func TestConvertOpenAIRequestSerializesTopPConsistently(t *testing.T) {
	tests := []struct {
		name        string
		stream      bool
		requestJSON string
		wantExists  bool
		wantTopP    float64
	}{
		{name: "non-stream omitted", requestJSON: `{"model":"qwen-plus"}`},
		{name: "stream omitted", stream: true, requestJSON: `{"model":"qwen-plus","stream":true}`},
		{name: "non-stream explicit zero", requestJSON: `{"model":"qwen-plus","top_p":0}`, wantExists: true, wantTopP: 0.01},
		{name: "stream explicit zero", stream: true, requestJSON: `{"model":"qwen-plus","stream":true,"top_p":0}`, wantExists: true, wantTopP: 0.01},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var request dto.GeneralOpenAIRequest
			require.NoError(t, common.Unmarshal([]byte(tt.requestJSON), &request))

			converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, &relaycommon.RelayInfo{
				IsStream: tt.stream,
				ChannelMeta: &relaycommon.ChannelMeta{
					UpstreamModelName: "qwen-plus",
				},
			}, &request)
			require.NoError(t, err)

			encoded, err := common.Marshal(converted)
			require.NoError(t, err)
			topP := gjson.GetBytes(encoded, "top_p")
			assert.Equal(t, tt.wantExists, topP.Exists())
			if tt.wantExists {
				assert.InDelta(t, tt.wantTopP, topP.Float(), 0.000001)
			}
		})
	}
}
