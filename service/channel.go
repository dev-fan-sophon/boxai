package service

import (
	"errors"
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/types"
)

func formatNotifyType(channelId int, status int) string {
	return fmt.Sprintf("%s_%d_%d", dto.NotifyTypeChannelUpdate, channelId, status)
}

// disable & notify
func DisableChannel(channelError types.ChannelError, reason string) {
	common.SysLog(fmt.Sprintf("通道「%s」（#%d）发生错误，准备禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, common.LocalLogPreview(reason)))

	// 检查是否启用自动禁用功能
	if !channelError.AutoBan {
		common.SysLog(fmt.Sprintf("通道「%s」（#%d）未启用自动禁用功能，跳过禁用操作", channelError.ChannelName, channelError.ChannelId))
		return
	}

	success := model.UpdateChannelStatus(channelError.ChannelId, channelError.UsingKey, common.ChannelStatusAutoDisabled, reason)
	if success {
		closeActiveWebSocketsAfterDisable(channelError.ChannelId)
		subject := fmt.Sprintf("通道「%s」（#%d）已被禁用", channelError.ChannelName, channelError.ChannelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, reason)
		NotifyRootUser(formatNotifyType(channelError.ChannelId, common.ChannelStatusAutoDisabled), subject, content)
	}
}

func EnableChannel(channelId int, usingKey string, channelName string) {
	success := model.UpdateChannelStatus(channelId, usingKey, common.ChannelStatusEnabled, "")
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		NotifyRootUser(formatNotifyType(channelId, common.ChannelStatusEnabled), subject, content)
	}
}

func ShouldDisableChannel(err *types.NewAPIError) bool {
	if !common.AutomaticDisableChannelEnabled {
		return false
	}
	if err == nil {
		return false
	}
	if diagnostic := err.Diagnostic(); diagnostic != nil && diagnostic["error_code"] == types.ErrorCode("401008") {
		return true
	}
	if types.IsChannelError(err) {
		return true
	}
	// Errors BoxAI raised itself say nothing about the channel: the request
	// may never have reached the upstream, and their message can echo client
	// input that would otherwise match a disable keyword.
	if isLocalRelayError(err) {
		return false
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	if operation_setting.ShouldDisableByStatusCode(err.OriginalStatusCode()) {
		return true
	}

	lowerMessage := strings.ToLower(err.Error())
	search, _ := AcSearch(lowerMessage, operation_setting.AutomaticDisableKeywords, true)
	return search
}

// isLocalRelayError reports whether a relay error was raised by BoxAI itself
// (request parsing, conversion, validation, billing, local timeouts) rather
// than carrying an upstream answer. Adaptors report upstream responses with
// BoxAI error values too, so the response and transport codes are not local,
// and a local error wrapping another relay error takes that error's origin.
func isLocalRelayError(err *types.NewAPIError) bool {
	if err.GetErrorType() != types.ErrorTypeNewAPIError || types.IsChannelError(err) {
		return false
	}
	switch err.GetErrorCode() {
	case types.ErrorCodeDoRequestFailed, types.ErrorCodeReadResponseBodyFailed, types.ErrorCodeBadResponseStatusCode,
		types.ErrorCodeBadResponse, types.ErrorCodeBadResponseBody, types.ErrorCodeEmptyResponse, types.ErrorCodeAwsInvokeError:
		return false
	}
	var inner *types.NewAPIError
	if errors.As(err.Unwrap(), &inner) && inner != err {
		return isLocalRelayError(inner)
	}
	return true
}

func ShouldEnableChannel(newAPIError *types.NewAPIError, status int) bool {
	if !common.AutomaticEnableChannelEnabled {
		return false
	}
	if newAPIError != nil {
		return false
	}
	if status != common.ChannelStatusAutoDisabled {
		return false
	}
	return true
}
