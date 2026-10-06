package model

import (
	"fmt"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const exclusionTestModel = "exclusion-test-model"

func createExclusionTestChannel(t *testing.T, id int, group string, priority int64) {
	t.Helper()
	weight := uint(100)
	require.NoError(t, DB.Create(&Channel{
		Id:       id,
		Type:     constant.ChannelTypeOpenAI,
		Key:      fmt.Sprintf("key-%d", id),
		Status:   common.ChannelStatusEnabled,
		Name:     fmt.Sprintf("channel-%d", id),
		Weight:   &weight,
		Models:   exclusionTestModel,
		Group:    group,
		Priority: &priority,
	}).Error)
	require.NoError(t, DB.Create(&Ability{
		Group:     group,
		Model:     exclusionTestModel,
		ChannelId: id,
		Enabled:   true,
		Priority:  &priority,
		Weight:    weight,
	}).Error)
}

// Both the memory cache and the database selection paths must exclude channels
// already attempted by the request and pick the highest remaining priority.
func TestGetRandomSatisfiedChannelExcludesAttemptedChannels(t *testing.T) {
	for _, memoryCache := range []bool{true, false} {
		t.Run(fmt.Sprintf("memory_cache=%v", memoryCache), func(t *testing.T) {
			truncateTables(t)
			originalMemoryCache := common.MemoryCacheEnabled
			common.MemoryCacheEnabled = memoryCache
			t.Cleanup(func() {
				common.MemoryCacheEnabled = originalMemoryCache
				DB.Exec("DELETE FROM abilities")
				DB.Exec("DELETE FROM channels")
				if memoryCache {
					InitChannelCache()
				}
			})

			createExclusionTestChannel(t, 3101, "default", 10)
			createExclusionTestChannel(t, 3102, "default", 10)
			createExclusionTestChannel(t, 3103, "default", 5)
			createExclusionTestChannel(t, 3201, "solo", 0)
			if memoryCache {
				InitChannelCache()
			}

			tests := []struct {
				name     string
				group    string
				retry    int
				excluded []int
				want     []int // nil means no channel
			}{
				{name: "initial selection uses highest priority", group: "default", retry: 0, want: []int{3101, 3102}},
				{name: "legacy retry index selects lower priority", group: "default", retry: 1, want: []int{3103}},
				{name: "legacy retry index clamps to lowest priority", group: "default", retry: 5, want: []int{3103}},
				{name: "untried same priority channel comes first", group: "default", retry: 1, excluded: []int{3101}, want: []int{3102}},
				{name: "other same priority channel excluded", group: "default", retry: 1, excluded: []int{3102}, want: []int{3101}},
				{name: "falls back to lower priority after same priority exhausted", group: "default", retry: 2, excluded: []int{3101, 3102}, want: []int{3103}},
				{name: "all channels attempted", group: "default", retry: 3, excluded: []int{3101, 3102, 3103}},
				{name: "unrelated exclusion keeps highest priority", group: "default", retry: 1, excluded: []int{3201}, want: []int{3101, 3102}},
				{name: "single channel initial selection", group: "solo", retry: 0, want: []int{3201}},
				{name: "single channel exhausted", group: "solo", retry: 1, excluded: []int{3201}},
			}
			for _, tt := range tests {
				t.Run(tt.name, func(t *testing.T) {
					channel, err := GetRandomSatisfiedChannel(tt.group, exclusionTestModel, tt.retry, "/v1/chat/completions", tt.excluded...)
					require.NoError(t, err)
					if tt.want == nil {
						assert.Nil(t, channel)
						return
					}
					require.NotNil(t, channel)
					assert.Contains(t, tt.want, channel.Id)
				})
			}
		})
	}
}
