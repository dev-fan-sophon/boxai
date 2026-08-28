package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newInheritedTokenRoutingContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	return ctx
}

func TestTokenRoutingAlwaysInheritsCurrentUserGroup(t *testing.T) {
	ctx := newInheritedTokenRoutingContext()
	token := &model.Token{
		Id:              1,
		UserId:          2,
		Group:           "legacy-pinned-group",
		CrossGroupRetry: true,
		AutoGroups:      `["vip","default"]`,
	}

	require.NoError(t, SetupContextForToken(ctx, token))
	setupInheritedTokenRouting(ctx, "payg")
	assert.Equal(t, "", common.GetContextKeyString(ctx, constant.ContextKeyTokenGroup))
	assert.False(t, common.GetContextKeyBool(ctx, constant.ContextKeyTokenCrossGroupRetry))
	assert.Equal(t, "payg", common.GetContextKeyString(ctx, constant.ContextKeyUserGroup))
	assert.Equal(t, "payg", common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup))
	_, hasAutoGroups := common.GetContextKey(ctx, constant.ContextKeyTokenAutoGroups)
	assert.False(t, hasAutoGroups)

	setupInheritedTokenRouting(ctx, "subscription-pro")
	assert.Equal(t, "subscription-pro", common.GetContextKeyString(ctx, constant.ContextKeyUserGroup))
	assert.Equal(t, "subscription-pro", common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup))
}
