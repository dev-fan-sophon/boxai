package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSumUsedQuotaKeepsQuotaWithRateStats(t *testing.T) {
	truncateTables(t)
	now := time.Now().Unix()
	require.NoError(t, LOG_DB.Create(&[]Log{
		{UserId: 1, Username: "stat-user", Type: LogTypeConsume, CreatedAt: now - 3600, Quota: 700, PromptTokens: 100, CompletionTokens: 50},
		{UserId: 1, Username: "stat-user", Type: LogTypeConsume, CreatedAt: now, Quota: 300, PromptTokens: 20, CompletionTokens: 10},
		{UserId: 1, Username: "stat-user", Type: LogTypeTopup, CreatedAt: now, Quota: 9000},
	}).Error)

	stat, err := SumUsedQuota(LogTypeConsume, 0, 0, "", "stat-user", "", 0, "")
	require.NoError(t, err)
	assert.Equal(t, Stat{Quota: 1000, Rpm: 1, Tpm: 30}, stat)
}
