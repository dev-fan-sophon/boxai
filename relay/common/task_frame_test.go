package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeTaskFrameReferences(t *testing.T) {
	req := TaskSubmitReq{
		Prompt:     "orbit",
		FirstFrame: "data:image/png;base64,AAA",
		LastFrame:  "https://example.com/last.png",
	}
	normalizeTaskFrameReferences(&req)
	assert.Equal(t, "data:image/png;base64,AAA", req.InputReference)
	assert.Equal(t, "data:image/png;base64,AAA", req.Image)
	require.Len(t, req.Images, 2)
	assert.Equal(t, "data:image/png;base64,AAA", req.Images[0])
	assert.Equal(t, "https://example.com/last.png", req.Images[1])
	assert.Equal(t, "https://example.com/last.png", req.Metadata["last_frame"])
}

func TestNormalizeTaskFrameReferences_Noop(t *testing.T) {
	req := TaskSubmitReq{Images: []string{"https://x"}}
	normalizeTaskFrameReferences(&req)
	assert.Equal(t, []string{"https://x"}, req.Images)
	assert.Empty(t, req.InputReference)
}
