package service

import (
	"strings"

	"github.com/dev-fan-sophon/boxai/constant"
)

func CoverTaskActionToModelName(platform constant.TaskPlatform, action string) string {
	return strings.ToLower(string(platform)) + "_" + strings.ToLower(action)
}
