package middleware

import (
	"net/http"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// EmailRiskLimit shares budgets across public verification and password reset.
// Changing endpoints does not reset a budget.
func EmailRiskLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		p := operation_setting.GetRegistrationRiskPolicy()
		if !p.Enabled {
			c.Next()
			return
		}
		email := model.NormalizeEmail(c.Query("email"))
		if common.Validate.Var(email, "required,email") != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid email address."})
			return
		}
		if err := model.TakeRegistrationRiskSlot(model.DB, "mail-ip", model.RegistrationRiskNetwork(common.RealClientIP(c)), p.EmailIPHourly, 3600); err != nil {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "Too many verification attempts. Please try again later."})
			return
		}
		if err := model.TakeRegistrationRiskSlot(model.DB, "mail-identity", common.EmailRiskIdentity(email), p.EmailIdentityHourly, 3600); err != nil {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "Too many verification attempts. Please try again later."})
			return
		}
		c.Next()
	}
}
