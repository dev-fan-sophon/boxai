package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetHomeStats(c *gin.Context) {
	result, err := service.GetHomeStats()
	if err != nil {
		common.SysError("failed to get public home stats: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Platform data is temporarily unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
