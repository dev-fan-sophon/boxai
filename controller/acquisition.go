package controller

import (
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"

	"github.com/gin-gonic/gin"
)

// acquisitionCookieName holds the marketing attribution the frontend captures on
// the visitor's first landing. It is read on every signup path (password and
// OAuth) because the OAuth callback is same-origin and carries the cookie back.
const acquisitionCookieName = "boxai_attr"

// acquisitionCookieMaxBytes bounds the untrusted cookie before it is parsed;
// attribution never legitimately exceeds a few hundred bytes.
const acquisitionCookieMaxBytes = 1024

// readAcquisition extracts marketing attribution from the request. A missing or
// malformed cookie is not an error: attribution is best-effort, and signup must
// never fail because of it.
func readAcquisition(c *gin.Context) model.AcquisitionAttribution {
	attribution := model.AcquisitionAttribution{}
	raw, err := c.Cookie(acquisitionCookieName)
	if err != nil || raw == "" || len(raw) > acquisitionCookieMaxBytes {
		return attribution
	}
	if err := common.UnmarshalJsonStr(raw, &attribution); err != nil {
		return attribution
	}
	return attribution
}
