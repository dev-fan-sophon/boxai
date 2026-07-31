package model

import "strings"

// Registration channel values stored in User.RegisterSource. OAuth providers are
// recorded as "oauth:<provider>" so the analytics layer can group them.
const (
	RegisterSourcePassword = "password"
	RegisterSourceAdmin    = "admin"
	RegisterSourceOAuth    = "oauth"
)

const (
	acquisitionSourceMaxLength   = 64
	acquisitionReferrerMaxLength = 255
	registerSourceMaxLength      = 32
	registerIpMaxLength          = 64
)

// AcquisitionAttribution carries the marketing attribution captured on the
// visitor's first landing, forwarded from the frontend attribution cookie.
type AcquisitionAttribution struct {
	UtmSource   string `json:"utm_source"`
	UtmMedium   string `json:"utm_medium"`
	UtmCampaign string `json:"utm_campaign"`
	Referrer    string `json:"referrer"`
}

// ApplyAcquisition stamps the signup channel and marketing attribution onto a
// user that is about to be inserted. Values are truncated to the column widths
// because they come straight from a client-controlled cookie.
func (user *User) ApplyAcquisition(registerSource string, ip string, attribution AcquisitionAttribution) {
	user.RegisterSource = truncateAcquisitionValue(registerSource, registerSourceMaxLength)
	user.RegisterIp = truncateAcquisitionValue(ip, registerIpMaxLength)
	user.UtmSource = truncateAcquisitionValue(attribution.UtmSource, acquisitionSourceMaxLength)
	user.UtmMedium = truncateAcquisitionValue(attribution.UtmMedium, acquisitionSourceMaxLength)
	user.UtmCampaign = truncateAcquisitionValue(attribution.UtmCampaign, acquisitionSourceMaxLength)
	user.RegisterReferrer = truncateAcquisitionValue(attribution.Referrer, acquisitionReferrerMaxLength)
}

func truncateAcquisitionValue(value string, max int) string {
	value = strings.TrimSpace(value)
	if len(value) <= max {
		return value
	}
	return value[:max]
}
