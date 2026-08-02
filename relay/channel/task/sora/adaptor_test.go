package sora

import (
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/stretchr/testify/require"
)

func TestParseTaskResultKeepsCompletedMediaURL(t *testing.T) {
	result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(`{
		"id":"upstream-task",
		"status":"completed",
		"progress":100,
		"metadata":{"url":"https://media.example/result.mp4?signature=test"}
	}`))

	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSuccess, result.Status)
	require.Equal(t, "https://media.example/result.mp4?signature=test", result.Url)
}
