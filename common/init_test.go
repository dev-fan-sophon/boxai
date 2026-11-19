package common

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/stretchr/testify/assert"
)

// Vendors keep video tasks running for up to 72 hours (Volcengine Ark can be
// configured to 72h, Vidu off-peak runs 48h), so the task timeout must not
// default to anything shorter.
func TestTaskTimeoutDefaultsToSeventyTwoHours(t *testing.T) {
	t.Setenv("TASK_TIMEOUT_MINUTES", "")
	previous := constant.TaskTimeoutMinutes
	t.Cleanup(func() { constant.TaskTimeoutMinutes = previous })

	initConstantEnv()

	assert.Equal(t, 72*60, constant.TaskTimeoutMinutes)
}
