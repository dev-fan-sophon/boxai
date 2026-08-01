package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExtractPlaygroundDocumentCode(t *testing.T) {
	script := "import docx\ndocx.Document().save('/workspace/out/a.docx')"

	tests := []struct {
		name  string
		reply string
		want  string
	}{
		{
			name:  "fenced python block with commentary around it",
			reply: "Sure, here you go:\n\n```python\n" + script + "\n```\n\nLet me know if you want changes.",
			want:  script,
		},
		{
			// Weaker models sketch an approach first and then give the real script.
			name:  "last python block wins when the model sketches first",
			reply: "```python\nprint('sketch')\n```\nNow the real one:\n```python\n" + script + "\n```",
			want:  script,
		},
		{
			name:  "untagged fence is accepted",
			reply: "```\n" + script + "\n```",
			want:  script,
		},
		{
			name:  "a python block outranks an untagged one",
			reply: "```\nnot the script\n```\n```python\n" + script + "\n```",
			want:  script,
		},
		{
			name:  "bare script without any fence",
			reply: script,
			want:  script,
		},
		{
			name:  "prose only",
			reply: "I cannot help with that request.",
			want:  "",
		},
		{
			name:  "empty fence",
			reply: "```python\n```",
			want:  "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ExtractPlaygroundDocumentCode(tt.reply))
		})
	}
}

func TestBuildPlaygroundDocumentSystemPromptEditPath(t *testing.T) {
	// An edit request must point the model at the existing file and forbid a rebuild, otherwise
	// unrelated content the user never mentioned disappears from the next version.
	prompt := BuildPlaygroundDocumentSystemPrompt(PlaygroundDocumentPrompt{
		Inputs:   []string{"sales.xlsx"},
		Previous: []string{"report.docx"},
	})
	assert.Contains(t, prompt, "/workspace/in/sales.xlsx")
	assert.Contains(t, prompt, "/workspace/in/previous/report.docx")
	assert.Contains(t, prompt, "Do not rebuild it from scratch")

	fresh := BuildPlaygroundDocumentSystemPrompt(PlaygroundDocumentPrompt{})
	assert.NotContains(t, fresh, "/workspace/in/previous/")
	assert.Contains(t, fresh, "/workspace/out/")
}

func TestBuildPlaygroundDocumentSystemPromptCarriesSkills(t *testing.T) {
	// The skill is where output quality comes from, so a prompt that silently loses it would
	// degrade every document without failing anything.
	xlsx := BuildPlaygroundDocumentSystemPrompt(PlaygroundDocumentPrompt{Formats: []string{"xlsx"}})
	assert.Contains(t, xlsx, "openpyxl")
	assert.Contains(t, xlsx, "freeze_panes")
	// Only the requested format's skill is attached; the others would just cost tokens.
	assert.NotContains(t, xlsx, "slide_layouts")

	// Defaulting to docx matters: "write me a report" names no format at all.
	assert.Contains(t, BuildPlaygroundDocumentSystemPrompt(PlaygroundDocumentPrompt{}), "python-docx")

	// The Chromium path must only be advertised when the worker can actually do it.
	withBrowser := BuildPlaygroundDocumentSystemPrompt(PlaygroundDocumentPrompt{Formats: []string{"pdf"}, HTMLPdf: true})
	withoutBrowser := BuildPlaygroundDocumentSystemPrompt(PlaygroundDocumentPrompt{Formats: []string{"pdf"}})
	assert.Contains(t, withBrowser, ".pdf.html")
	assert.NotContains(t, withoutBrowser, ".pdf.html")
	assert.Contains(t, withoutBrowser, "UnicodeCIDFont")
}

func TestDetectPlaygroundDocumentFormats(t *testing.T) {
	tests := []struct {
		text string
		want []string
	}{
		{"帮我做一个季度汇报 PPT", []string{"pptx"}},
		{"生成销售数据表格", []string{"xlsx"}},
		{"把这份内容导出成 PDF", []string{"pdf"}},
		{"写一份项目报告", []string{"docx"}},
		{"create an invoice as a pdf", []string{"pdf"}},
		{"lập báo cáo doanh thu", []string{"docx"}},
		// No format named at all still has to produce something.
		{"整理一下上个月的情况", []string{"docx"}},
		// A deck that also needs the numbers keeps both, in a fixed order.
		{"做一个 PPT，附上 Excel 明细", []string{"pptx", "xlsx"}},
	}
	for _, tt := range tests {
		t.Run(tt.text, func(t *testing.T) {
			assert.Equal(t, tt.want, DetectPlaygroundDocumentFormats(tt.text))
		})
	}
}

func TestBuildPlaygroundDocumentSystemPromptCarriesFailure(t *testing.T) {
	prompt := BuildPlaygroundDocumentSystemPrompt(PlaygroundDocumentPrompt{
		PreviousCode: "import docx",
		FailureLog:   "ModuleNotFoundError: No module named 'weasyprint'",
	})
	assert.Contains(t, prompt, "Your previous script failed")
	assert.Contains(t, prompt, "weasyprint")
	assert.Contains(t, prompt, "import docx")
}
