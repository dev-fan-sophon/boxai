package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/system_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const maxPlaygroundMemoryInputRunes = 400

func ListPlaygroundUserMemories(c *gin.Context) {
	items, err := model.ListPlaygroundUserMemories(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"items":   items,
		"enabled": system_setting.GetPlaygroundMemorySettings().Ready(),
	})
}

func UpdatePlaygroundUserMemory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid id")
		return
	}
	var body struct {
		Content  string  `json:"content"`
		Category *string `json:"category"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	content := truncateRunes(strings.TrimSpace(body.Content), maxPlaygroundMemoryInputRunes)
	if content == "" {
		common.ApiErrorMsg(c, "content is required")
		return
	}
	// An absent category keeps the stored classification; only an explicit
	// value is normalized (unknown values fall back to "other").
	category := ""
	if body.Category != nil {
		category = strings.ToLower(strings.TrimSpace(*body.Category))
		if category != "profile" && category != "preference" && category != "project" {
			category = "other"
		}
	}
	if err := model.UpdatePlaygroundUserMemory(id, c.GetInt("id"), content, category); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorMsg(c, "memory not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func DeletePlaygroundUserMemory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid id")
		return
	}
	if err := model.DeletePlaygroundUserMemory(id, c.GetInt("id")); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			common.ApiErrorMsg(c, "memory not found")
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ClearPlaygroundUserMemories(c *gin.Context) {
	if err := model.DeleteAllPlaygroundUserMemories(c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
