package controller

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/setting"
	"github.com/stretchr/testify/assert"
)

func TestCreemSignatureFailsClosedWithoutSecret(t *testing.T) {
	old := setting.CreemTestMode
	t.Cleanup(func() { setting.CreemTestMode = old })
	for _, testMode := range []bool{false, true} {
		setting.CreemTestMode = testMode
		assert.False(t, verifyCreemSignature("payload", "", ""))
		assert.False(t, verifyCreemSignature("payload", generateCreemSignature("payload", ""), ""))
		assert.True(t, verifyCreemSignature("payload", generateCreemSignature("payload", "configured"), "configured"))
		assert.False(t, verifyCreemSignature("changed", generateCreemSignature("payload", "configured"), "configured"))
	}
}
