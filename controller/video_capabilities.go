package controller

import (
	"net/http"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/gin-gonic/gin"
)

func GetPlaygroundVideoCapabilities(c *gin.Context) {
	user, err := model.GetUserCache(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	modelName := strings.TrimSpace(c.Query("model"))
	if modelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "model is required"})
		return
	}
	usable := service.GetUserUsableGroups(user.Group)
	group := c.Query("group")
	var groups []string
	switch group {
	case "":
		for candidate := range usable {
			groups = append(groups, candidate)
		}
	case "auto":
		if _, ok := usable["auto"]; ok {
			groups = service.GetUserAutoGroup(user.Group)
		}
	default:
		if _, ok := usable[group]; ok {
			groups = []string{group}
		}
	}
	profiles, err := service.ResolveVideoCapabilities(groups, modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": profiles})
}
