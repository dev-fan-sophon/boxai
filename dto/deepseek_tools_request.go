package dto

import (
	"encoding/json"

	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
)

// DeepSeekToolsRequest is a DeepSeek Search or Fetch API request
// (/v1/tools/search, /v1/tools/fetch). The body names no model; Model holds
// the routing name. RawBody preserves the original JSON so the body is
// forwarded with unknown fields intact.
type DeepSeekToolsRequest struct {
	Model   string          `json:"model,omitempty"`
	RawBody json.RawMessage `json:"-"`
}

func (r *DeepSeekToolsRequest) GetTokenCountMeta() *types.TokenCountMeta {
	return &types.TokenCountMeta{CombineText: string(r.RawBody), TokenType: types.TokenTypeTokenizer}
}

func (r *DeepSeekToolsRequest) IsStream(*gin.Context) bool {
	return false
}

func (r *DeepSeekToolsRequest) SetModelName(modelName string) {
	if modelName != "" {
		r.Model = modelName
	}
}
