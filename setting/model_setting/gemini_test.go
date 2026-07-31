package model_setting_test

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/relay/channel/gemini"
	"github.com/dev-fan-sophon/boxai/setting/model_setting"
	"github.com/stretchr/testify/assert"
)

func TestGeminiGAImageModelsAreAdvertisedAndImageCapable(t *testing.T) {
	for _, model := range []string{"gemini-3-pro-image", "gemini-3.1-flash-image"} {
		t.Run(model, func(t *testing.T) {
			assert.Contains(t, gemini.ModelList, model)
			assert.True(t, model_setting.IsGeminiModelSupportImagine(model))
		})
	}
}
