package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dev-fan-sophon/boxai/model"
	"github.com/glebarez/sqlite"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRelayMidjourneyImageRejectsForeignTask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Midjourney{}))
	model.DB = db
	t.Cleanup(func() { model.DB = originalDB })

	require.NoError(t, db.Create(&model.Midjourney{UserId: 7, MjId: "foreign-task"}).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/mj/image/foreign-task", nil)
	c.Params = gin.Params{{Key: "id", Value: "foreign-task"}}
	c.Set("id", 8)

	RelayMidjourneyImage(c)

	assert.Equal(t, http.StatusNotFound, recorder.Code)
	assert.JSONEq(t, `{"error":"midjourney_task_not_found"}`, recorder.Body.String())
}
