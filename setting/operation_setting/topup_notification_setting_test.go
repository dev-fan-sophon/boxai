package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTopUpReviewNotificationRecipientValidation(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
		valid bool
	}{
		{"disabled", `{"enabled":false,"recipients":[]}`, true},
		{"enabled", `{"enabled":true,"recipients":["admin@example.com"]}`, true},
		{"missing recipients", `{"enabled":true}`, false},
		{"malformed", `{`, false},
		{"duplicate", `{"enabled":true,"recipients":["admin@example.com","ADMIN@example.com"]}`, false},
		{"display name", `{"enabled":true,"recipients":["Admin <admin@example.com>"]}`, false},
		{"header injection", `{"enabled":true,"recipients":["admin@example.com\r\nBcc: other@example.com"]}`, false},
		{"invalid address", `{"enabled":false,"recipients":["admin"]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseTopUpReviewNotificationSetting(tc.value)
			if tc.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}
