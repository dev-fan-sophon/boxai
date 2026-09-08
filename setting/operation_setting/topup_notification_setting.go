package operation_setting

import (
	"errors"
	"net/mail"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
)

const TopUpReviewNotificationOptionKey = "TopUpReviewNotificationSettings"

type TopUpReviewNotificationSetting struct {
	Enabled    bool     `json:"enabled"`
	Recipients []string `json:"recipients"`
}

func ParseTopUpReviewNotificationSetting(value string) (TopUpReviewNotificationSetting, error) {
	var setting TopUpReviewNotificationSetting
	if err := common.UnmarshalJsonStr(value, &setting); err != nil {
		return setting, errors.New("invalid top-up notification settings")
	}
	if len(setting.Recipients) > 10 || (setting.Enabled && len(setting.Recipients) == 0) {
		return setting, errors.New("top-up notifications require 1 to 10 email recipients when enabled")
	}
	seen := make(map[string]bool)
	for _, recipient := range setting.Recipients {
		address, err := mail.ParseAddress(recipient)
		if err != nil || len(recipient) > 254 || strings.ContainsAny(recipient, "\r\n;") || address.Address != recipient || seen[strings.ToLower(recipient)] {
			return setting, errors.New("top-up notification recipients must be unique email addresses without display names")
		}
		seen[strings.ToLower(recipient)] = true
	}
	return setting, nil
}

func GetTopUpReviewNotificationSetting() TopUpReviewNotificationSetting {
	common.OptionMapRWMutex.RLock()
	value := common.OptionMap[TopUpReviewNotificationOptionKey]
	common.OptionMapRWMutex.RUnlock()
	setting, err := ParseTopUpReviewNotificationSetting(value)
	if err != nil {
		return TopUpReviewNotificationSetting{}
	}
	return setting
}
