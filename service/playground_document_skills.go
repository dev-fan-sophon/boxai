package service

import (
	"embed"
	"strings"
)

//go:embed document_skills/*.md
var documentSkillFiles embed.FS

// PlaygroundDocumentFormats lists the deliverable formats the sandbox can produce, in the order
// they are offered to the model when a request names more than one.
var PlaygroundDocumentFormats = []string{"docx", "xlsx", "pptx", "pdf"}

// maxDocumentSkillsPerPrompt bounds prompt growth. Each skill is a few thousand tokens, and a
// request that genuinely needs three different formats is rare enough not to pay for it every
// time.
const maxDocumentSkillsPerPrompt = 2

// DetectPlaygroundDocumentFormats reads the deliverable formats out of the user's request.
//
// The order of the checks matters: a request that says "PowerPoint" must not also match the
// generic word for a document. When nothing matches, docx is the answer, because a request that
// says only "write me a report" means a text document.
func DetectPlaygroundDocumentFormats(text string) []string {
	s := strings.ToLower(text)
	seen := map[string]bool{}
	ordered := []string{}
	add := func(format string) {
		if !seen[format] {
			seen[format] = true
			ordered = append(ordered, format)
		}
	}

	if containsAny(s, "ppt", "powerpoint", "幻灯片", "演示文稿", "slide", "deck", "presentation", "trình chiếu") {
		add("pptx")
	}
	if containsAny(s, "excel", "xlsx", "表格", "工作表", "spreadsheet", "worksheet", "csv", "bảng tính") {
		add("xlsx")
	}
	if containsAny(s, "pdf") {
		add("pdf")
	}
	if containsAny(s, "word", "docx", "文档", "报告", "简历", "合同", "说明书", "白皮书", "计划书",
		"document", "report", "resume", "contract", "proposal", "letter", "báo cáo", "tài liệu") {
		add("docx")
	}
	if len(ordered) == 0 {
		return []string{"docx"}
	}
	if len(ordered) > maxDocumentSkillsPerPrompt {
		return ordered[:maxDocumentSkillsPerPrompt]
	}
	return ordered
}

// PlaygroundDocumentSkill returns the authoring guidance for one format. htmlPdf adds the
// browser-rendered PDF path, which is only correct while the worker has a browser binding.
func PlaygroundDocumentSkill(format string, htmlPdf bool) string {
	content, err := documentSkillFiles.ReadFile("document_skills/" + format + ".md")
	if err != nil {
		return ""
	}
	skill := string(content)
	if format == "pdf" && htmlPdf {
		if extra, extraErr := documentSkillFiles.ReadFile("document_skills/pdf_html.md"); extraErr == nil {
			skill += "\n" + string(extra)
		}
	}
	return skill
}
