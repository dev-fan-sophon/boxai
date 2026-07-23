package service

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManagedXAISearchReservationQuotaUsesReservedCallAllowance(t *testing.T) {
	quota, clamp := ManagedXAISearchReservationQuota("grok-4.5", 8, 1)
	require.Nil(t, clamp)
	assert.Equal(t, 20000, quota)

	quota, clamp = ManagedXAISearchReservationQuota("grok-4.5", 0, 1)
	assert.Zero(t, quota)
	assert.Nil(t, clamp)
	quota, clamp = ManagedXAISearchReservationQuota("grok-4.5", 8, 0)
	assert.Zero(t, quota)
	assert.Nil(t, clamp)
}

func TestManagedXAISearchReservationQuotaSaturates(t *testing.T) {
	quota, clamp := ManagedXAISearchReservationQuota("grok-4.5", math.MaxInt, math.MaxFloat64)
	assert.Equal(t, common.MaxQuota, quota)
	require.NotNil(t, clamp)
}
