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
	groups, modelName, ok := playgroundCapabilityScope(c)
	if !ok {
		return
	}
	profiles, err := service.ResolveVideoCapabilities(groups, modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": profiles})
}

// GetPlaygroundImageCapabilities returns the image options every channel that
// routing may select for the model supports; data is null when unmodeled.
func GetPlaygroundImageCapabilities(c *gin.Context) {
	groups, modelName, ok := playgroundCapabilityScope(c)
	if !ok {
		return
	}
	profile, err := service.ResolveImageCapabilities(groups, modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": profile})
}

// playgroundCapabilityScope resolves the `model` query and the groups the
// signed-in user may route through for the `group` query ("" = all usable
// groups, "auto" = the auto group chain). It writes the error response itself.
func playgroundCapabilityScope(c *gin.Context) ([]string, string, bool) {
	user, err := model.GetUserCache(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return nil, "", false
	}
	modelName := strings.TrimSpace(c.Query("model"))
	if modelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "model is required"})
		return nil, "", false
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
	return groups, modelName, true
}
