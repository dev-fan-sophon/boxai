package controller

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestShouldRetryManagedSearchNeverChangesPinnedChannel(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set("playground_managed_search", true)
	err := types.NewError(errors.New("mapped model failed"), types.ErrorCodeChannelModelMappedError)
	assert.False(t, shouldRetry(c, err, 3))
}
