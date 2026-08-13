package console_setting

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestValidateConsoleSettingsUsesUTF16CharacterLimits(t *testing.T) {
	tests := []struct {
		name        string
		settingType string
		atLimit     string
		overLimit   string
		errorText   string
	}{
		{
			name:        "API route",
			settingType: "ApiInfo",
			atLimit:     fmt.Sprintf(`[{"url":"https://example.com","route":%q,"description":"ok","color":"blue"}]`, strings.Repeat("😀", 50)),
			overLimit:   fmt.Sprintf(`[{"url":"https://example.com","route":%q,"description":"ok","color":"blue"}]`, strings.Repeat("😀", 51)),
			errorText:   "线路描述长度不能超过100字符",
		},
		{
			name:        "announcement content",
			settingType: "Announcements",
			atLimit:     fmt.Sprintf(`[{"content":%q,"publishDate":"2026-08-13T00:00:00Z"}]`, strings.Repeat("😀", 250)),
			overLimit:   fmt.Sprintf(`[{"content":%q,"publishDate":"2026-08-13T00:00:00Z"}]`, strings.Repeat("😀", 251)),
			errorText:   "内容长度不能超过500字符",
		},
		{
			name:        "FAQ question",
			settingType: "FAQ",
			atLimit:     fmt.Sprintf(`[{"question":%q,"answer":"ok"}]`, strings.Repeat("😀", 100)),
			overLimit:   fmt.Sprintf(`[{"question":%q,"answer":"ok"}]`, strings.Repeat("😀", 101)),
			errorText:   "问题长度不能超过200字符",
		},
		{
			name:        "uptime category",
			settingType: "UptimeKumaGroups",
			atLimit:     fmt.Sprintf(`[{"categoryName":%q,"url":"https://example.com","slug":"status"}]`, strings.Repeat("😀", 25)),
			overLimit:   fmt.Sprintf(`[{"categoryName":%q,"url":"https://example.com","slug":"status"}]`, strings.Repeat("😀", 26)),
			errorText:   "分类名称长度不能超过50字符",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.NoError(t, ValidateConsoleSettings(test.atLimit, test.settingType))
			require.ErrorContains(t, ValidateConsoleSettings(test.overLimit, test.settingType), test.errorText)
		})
	}
}

func TestValidateAnnouncementsExtraMatchesFrontendLimit(t *testing.T) {
	atLimit := fmt.Sprintf(
		`[{"content":"ok","publishDate":"2026-08-13T00:00:00Z","extra":%q}]`,
		strings.Repeat("界", 100),
	)
	overLimit := fmt.Sprintf(
		`[{"content":"ok","publishDate":"2026-08-13T00:00:00Z","extra":%q}]`,
		strings.Repeat("界", 101),
	)

	require.NoError(t, ValidateConsoleSettings(atLimit, "Announcements"))
	require.ErrorContains(t, ValidateConsoleSettings(overLimit, "Announcements"), "说明长度不能超过100字符")
}
