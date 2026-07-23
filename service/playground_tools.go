package service

import "strings"

const MaxPlaygroundSearchQueryRunes = 1500

const (
	PlaygroundToolChat   = "chat"
	PlaygroundToolImage  = "generate_image"
	PlaygroundToolVideo  = "generate_video"
	PlaygroundToolSearch = "web_search"
)

// ClassifyPlaygroundTool deliberately prefers precision. Questions about how
// to create media and negated requests stay in chat.
func ClassifyPlaygroundTool(text string) string {
	s := strings.ToLower(strings.TrimSpace(text))
	if s == "" {
		return PlaygroundToolChat
	}
	for _, marker := range []string{"如何", "怎么", "怎样", "教程", "how to", "how do", "不要", "不用", "别", "don't", "do not", "without"} {
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
	return PlaygroundToolChat
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
