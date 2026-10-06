package service

import (
	"fmt"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/pkg/wsmanager"
)

const ChannelDisabledCloseReason = "channel disabled or deleted"

// CloseActiveWebSocketsForChannels ends persistent realtime and Responses
// WebSocket sessions bound to the channels, on this node and, through Redis,
// on every other node.
func CloseActiveWebSocketsForChannels(channelIDs []int, reason string) int {
	return wsmanager.CloseChannelsAndBroadcast(channelIDs, reason)
}

// closeActiveWebSocketsAfterDisable closes a channel's sessions only once the
// whole channel is no longer enabled; disabling one key of a multi-key channel
// keeps other sessions, whose pinned key is revalidated on every turn.
func closeActiveWebSocketsAfterDisable(channelID int) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to check channel status before closing active websockets: channel_id=%d, error=%v", channelID, err))
	} else if channel.Status == common.ChannelStatusEnabled {
		return
	}
	CloseActiveWebSocketsForChannels([]int{channelID}, ChannelDisabledCloseReason)
}
