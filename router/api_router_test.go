package router

import (
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestUserOperationsRoutesRegister guards the user operations API surface, where
// a static segment (`/stats/...`) and a parameter segment (`/:id/profile`) are
// siblings. A conflicting registration panics at process start, so this failure
// mode has to be caught before deployment rather than at boot.
func TestUserOperationsRoutesRegister(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	require.NotPanics(t, func() { SetApiRouter(engine) })

	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	for _, path := range []string{
		"GET /api/v1/connector/manifest",
		"GET /api/v1/connector/authorize",
		"POST /api/v1/connector/token",
		"GET /api/v1/connector/provisioning",
		"POST /api/v1/connector/revoke",
		"GET /api/admin/connector/mcp-servers",
		"POST /api/admin/connector/mcp-servers",
		"PUT /api/admin/connector/mcp-servers/:id",
		"DELETE /api/admin/connector/mcp-servers/:id",
		"GET /api/admin/connector/skill-releases",
		"POST /api/admin/connector/skill-releases",
		"PUT /api/admin/connector/skill-releases/:id/:version",
		"DELETE /api/admin/connector/skill-releases/:id/:version",
		"GET /api/admin/users/stats/overview",
		"GET /api/admin/users/stats/funnel",
		"GET /api/admin/users/stats/retention",
		"GET /api/admin/users/stats/revenue",
		"GET /api/admin/users/stats/acquisition",
		"POST /api/admin/users/query",
		"GET /api/admin/users/tags",
		"GET /api/admin/users/:id/profile",
		"POST /api/admin/users/bulk",
		"POST /api/admin/users/export",
		"GET /api/admin/segments",
		"POST /api/admin/segments",
		"POST /api/admin/segments/preview",
		"PUT /api/admin/segments/:id",
		"DELETE /api/admin/segments/:id",
		"GET /api/admin/segments/campaigns",
		"POST /api/admin/segments/campaigns",
		"POST /api/acquisition/track",
	} {
		assert.True(t, registered[path], "missing route %s", path)
	}
}
