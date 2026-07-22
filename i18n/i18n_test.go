package i18n

import (
	"regexp"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func TestVietnameseLanguageSupport(t *testing.T) {
	require.NoError(t, Init())

	assert.Equal(t, LangVi, ParseAcceptLanguage("vi-VN,vi;q=0.9,en;q=0.8"))
	assert.Equal(t, LangVi, ParseAcceptLanguage("vi_VN"))
	assert.Contains(t, SupportedLanguages(), LangVi)
	assert.True(t, IsSupported("vi-VN"))
	assert.Equal(t, "Tham số không hợp lệ", Translate("vi-VN", "common.invalid_params"))
	assert.Equal(t, "Tối đa 7 yêu cầu trong 3 phút", Translate("vi_VN", "rate_limit.reached", map[string]any{"Max": 7, "Minutes": 3}))
	assert.Equal(t, "Không thể bật GitHub OAuth. Hãy nhập GitHub Client ID và GitHub Client Secret trước.", Translate("vi", MsgOptionGitHubOAuthConfigRequired))
	assert.Equal(t, "Không thể cập nhật hệ số hình ảnh: JSON không hợp lệ", Translate("vi", MsgOptionImageRatioFailed, map[string]any{"Error": "JSON không hợp lệ"}))
}

func TestUnknownLanguageFallsBackToEnglish(t *testing.T) {
	require.NoError(t, Init())

	assert.Equal(t, DefaultLang, ParseAcceptLanguage("xx-YY"))
	assert.Equal(t, "Invalid parameters", Translate("xx-YY", "common.invalid_params"))
}

func TestBackendCatalogsMatchEnglish(t *testing.T) {
	englishData, err := localeFS.ReadFile("locales/en.yaml")
	require.NoError(t, err)

	var english map[string]string
	require.NoError(t, yaml.Unmarshal(englishData, &english))

	templatePattern := regexp.MustCompile(`\{\{\.[^}]+}}`)
	for _, locale := range []string{"zh-CN", "zh-TW", "vi"} {
		t.Run(locale, func(t *testing.T) {
			localeData, err := localeFS.ReadFile("locales/" + locale + ".yaml")
			require.NoError(t, err)
			var messages map[string]string
			require.NoError(t, yaml.Unmarshal(localeData, &messages))
			assert.Equal(t, len(english), len(messages))

			for key, englishMessage := range english {
				message, ok := messages[key]
				assert.True(t, ok, "missing %s message %q", locale, key)
				assert.NotEmpty(t, message, "empty %s message %q", locale, key)

				englishTemplates := templatePattern.FindAllString(englishMessage, -1)
				localeTemplates := templatePattern.FindAllString(message, -1)
				sort.Strings(englishTemplates)
				sort.Strings(localeTemplates)
				assert.Equal(t, englishTemplates, localeTemplates, "template placeholders differ for %q", key)
			}
		})
	}
}
