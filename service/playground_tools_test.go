package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClassifyPlaygroundTool(t *testing.T) {
	tests := []struct{ text, want string }{
		{"请生成一张海边日落图片", PlaygroundToolImage},
		{"生成一个小猫照片", PlaygroundToolImage},
		{"画一个头像", PlaygroundToolImage},
		{"制作复古海报", PlaygroundToolImage},
		{"design a fox logo", PlaygroundToolImage},
		{"create a watercolor illustration", PlaygroundToolImage},
		{"create a video of a flying car", PlaygroundToolVideo},
		{"制作一个产品短片", PlaygroundToolVideo},
		{"搜索今天的 AI 新闻", PlaygroundToolSearch},
		{"look up the latest Go release", PlaygroundToolSearch},
		{"如何生成图片？", PlaygroundToolChat},
		{"How to create a video?", PlaygroundToolChat},
		{"不要生成图片，解释构图", PlaygroundToolChat},
		{"不要生成照片", PlaygroundToolChat},
		{"生成一个总结", PlaygroundToolChat},
		{"如何生成图片", PlaygroundToolChat},
		{"你好", PlaygroundToolChat},
		{"帮我写一份季度报告", PlaygroundToolDocument},
		{"做一个销售数据表格", PlaygroundToolDocument},
		{"生成一份产品介绍 PPT", PlaygroundToolDocument},
		{"create a project proposal document", PlaygroundToolDocument},
		{"把这份内容导出成 PDF", PlaygroundToolDocument},
		{"总结一下这个 PDF", PlaygroundToolChat},
		{"summarize the attached report", PlaygroundToolChat},
		{"翻译这份合同", PlaygroundToolChat},
		{"制作复古海报", PlaygroundToolImage},
	}
	for _, tt := range tests {
		t.Run(tt.text, func(t *testing.T) { assert.Equal(t, tt.want, ClassifyPlaygroundTool(tt.text)) })
	}
}
