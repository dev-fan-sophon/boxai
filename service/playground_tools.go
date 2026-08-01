package service

import "strings"

const MaxPlaygroundSearchQueryRunes = 1500

const (
	PlaygroundToolChat     = "chat"
	PlaygroundToolImage    = "generate_image"
	PlaygroundToolVideo    = "generate_video"
	PlaygroundToolSearch   = "web_search"
	PlaygroundToolDocument = "generate_document"
)

// Phrasings that keep a request in chat no matter what nouns it mentions:
// questions about how to do something and negated requests.
var playgroundChatGuards = []string{"如何", "怎么", "怎样", "教程", "how to", "how do", "不要", "不用", "别", "don't", "do not", "without"}

// ClassifyPlaygroundTool deliberately prefers precision. Questions about how
// to create media and negated requests stay in chat.
func ClassifyPlaygroundTool(text string) string {
	s := strings.ToLower(strings.TrimSpace(text))
	if s == "" {
		return PlaygroundToolChat
	}
	for _, marker := range playgroundChatGuards {
		if strings.Contains(s, marker) {
			return PlaygroundToolChat
		}
	}
	if containsAny(s, "搜索", "搜一下", "查一下", "查询最新", "上网查", "search the web", "web search", "look up", "latest news") {
		return PlaygroundToolSearch
	}
	if hasMediaIntent(s,
		[]string{"生成", "制作", "做", "拍", "generate", "create", "make", "produce"},
		[]string{"视频", "短片", "动画", "video", "clip", "animation"}) {
		return PlaygroundToolVideo
	}
	if hasMediaIntent(s,
		[]string{"生成", "画", "绘制", "制作", "做", "设计", "generate", "create", "make", "draw", "design"},
		[]string{"图片", "照片", "头像", "海报", "插画", "图像", "logo", "image", "picture", "photo", "avatar", "poster", "illustration"}) {
		return PlaygroundToolImage
	}
	if playgroundDocumentIntent(s) {
		return PlaygroundToolDocument
	}
	return PlaygroundToolChat
}

// playgroundDocumentIntent expects lowercased trimmed text. A document request
// has to name a deliverable, not merely mention a file. "Summarise this PDF"
// is a chat turn about an upload and must not start a build; "export it as
// PDF" is a build even though it names no verb from the create list.
func playgroundDocumentIntent(s string) bool {
	documentNouns := []string{"文档", "文件", "报告", "报表", "表格", "工作表", "简历", "合同", "发票",
		"计划书", "方案书", "说明书", "白皮书", "演示文稿", "幻灯片", "ppt", "word", "excel", "pdf",
		"docx", "xlsx", "pptx", "csv", "powerpoint", "spreadsheet", "worksheet", "document",
		"report", "resume", "invoice", "contract", "proposal", "slide", "deck", "presentation"}
	if !containsAny(s, documentNouns...) {
		return false
	}
	exportIntent := containsAny(s, "导出", "另存", "存成", "保存为", "转成", "转为", "转换成",
		"汇总成", "汇总为", "合并成", "做成", "弄成",
		"export", "save as", "download as", "convert", "turn into", "turn it into",
		"turn this into", "turn that into", "compile into", "combine into")
	readIntent := containsAny(s, "总结", "摘要", "解释", "翻译", "分析一下", "summarize", "summarise", "explain", "translate")
	createIntent := containsAny(s, "生成", "制作", "做", "写", "整理", "创建", "新建", "输出",
		"generate", "create", "make", "write", "build", "draft", "prepare", "produce")
	return exportIntent || (createIntent && !readIntent)
}

// PlaygroundDocumentFollowupIntent reports whether a request that already
// routed to another tool (classification picks exactly one) ALSO asks for a
// document deliverable, e.g. "search this week's AI news, then make a PDF".
// The client chains a document build after the first tool completes. Guards
// mirror ClassifyPlaygroundTool: a how-to or negated request never chains.
func PlaygroundDocumentFollowupIntent(text string) bool {
	s := strings.ToLower(strings.TrimSpace(text))
	if s == "" {
		return false
	}
	for _, marker := range playgroundChatGuards {
		if strings.Contains(s, marker) {
			return false
		}
	}
	return playgroundDocumentIntent(s)
}

func hasMediaIntent(s string, actions, nouns []string) bool {
	return containsAny(s, actions...) && containsAny(s, nouns...)
}
func containsAny(s string, values ...string) bool {
	for _, v := range values {
		if strings.Contains(s, v) {
			return true
		}
	}
	return false
}
