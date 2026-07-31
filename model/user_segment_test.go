package model

import (
	"testing"
	"time"

	"github.com/dev-fan-sophon/boxai/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func collectRowIDs(rows []*AdminUserRow) []int {
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.Id)
	}
	return ids
}

// TestUserQueryFilterSelectsLifecycleAudiences pins the segment predicates that
// campaigns fan out on. A filter that silently matches the wrong audience would
// send quota or email to the wrong users.
func TestUserQueryFilterSelectsLifecycleAudiences(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	dormantDay := today - 40*secondsPerDay

	payer := seedAnalyticsUser(t, 21, today, RegisterSourcePassword, "newsletter")
	activeFree := seedAnalyticsUser(t, 22, today, RegisterSourcePassword, "newsletter")
	dormant := seedAnalyticsUser(t, 23, dormantDay, RegisterSourceOAuth+":zalo", "")
	neverActive := seedAnalyticsUser(t, 24, today, RegisterSourcePassword, "")

	seedQuotaData(t, payer.Id, today+3600, "gpt-4o", 100, 1000)
	seedQuotaData(t, activeFree.Id, today+3600, "gpt-4o", 20, 200)
	seedQuotaData(t, dormant.Id, dormantDay+3600, "gpt-4o", 5, 50)
	seedSuccessfulTopUp(t, payer.Id, today+100, 25)
	require.NoError(t, RollupUserMetrics(0))

	paidOnly := true
	paidRows, total, err := QueryUsers(UserQueryFilter{HasPaid: &paidOnly}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, []int{payer.Id}, collectRowIDs(paidRows))

	unpaid := false
	unpaidRows, _, err := QueryUsers(UserQueryFilter{HasPaid: &unpaid}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, []int{activeFree.Id, dormant.Id, neverActive.Id}, collectRowIDs(unpaidRows))

	dormantRows, _, err := QueryUsers(UserQueryFilter{InactiveDays: 14}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, []int{dormant.Id}, collectRowIDs(dormantRows))

	neverRows, _, err := QueryUsers(UserQueryFilter{NeverActive: true}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, []int{neverActive.Id}, collectRowIDs(neverRows))

	minSpend := 10.0
	spendRows, _, err := QueryUsers(UserQueryFilter{MinTopupMoney: &minSpend}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, []int{payer.Id}, collectRowIDs(spendRows))

	sourceRows, _, err := QueryUsers(UserQueryFilter{RegisterSource: RegisterSourceOAuth + ":zalo"}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, []int{dormant.Id}, collectRowIDs(sourceRows))
}

// TestUserTagsScopeAudienceAndAreIdempotent covers the manual tagging path used
// by bulk actions: re-tagging the same user must not create duplicate rows, and
// a tag filter must return exactly the tagged users.
func TestUserTagsScopeAudienceAndAreIdempotent(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	first := seedAnalyticsUser(t, 25, today, RegisterSourcePassword, "")
	second := seedAnalyticsUser(t, 26, today, RegisterSourcePassword, "")

	applied, err := AttachUserTag([]int{first.Id, second.Id}, "vip", 1)
	require.NoError(t, err)
	assert.Equal(t, 2, applied)

	applied, err = AttachUserTag([]int{first.Id, second.Id}, "vip", 1)
	require.NoError(t, err)
	assert.Equal(t, 0, applied)

	rows, total, err := QueryUsers(UserQueryFilter{Tags: []string{"vip"}}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Equal(t, []string{"vip"}, rows[0].Tags)

	removed, err := DetachUserTag([]int{first.Id}, "vip")
	require.NoError(t, err)
	assert.Equal(t, int64(1), removed)

	remaining, err := ListUserTagNames()
	require.NoError(t, err)
	require.Len(t, remaining, 1)
	assert.Equal(t, "vip", remaining[0].Tag)
	assert.Equal(t, int64(1), remaining[0].Users)
}

// TestUserQueryFilterDeletedStatusListsSoftDeletedUsers preserves the legacy
// SearchUsers contract: status -1 lists soft-deleted accounts, which every other
// filter must exclude.
func TestUserQueryFilterDeletedStatusListsSoftDeletedUsers(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	alive := seedAnalyticsUser(t, 27, today, RegisterSourcePassword, "")
	removed := seedAnalyticsUser(t, 28, today, RegisterSourcePassword, "")
	require.NoError(t, DB.Delete(&User{}, "id = ?", removed.Id).Error)

	defaultRows, total, err := QueryUsers(UserQueryFilter{}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, []int{alive.Id}, collectRowIDs(defaultRows))

	deletedStatus := UserStatusFilterDeleted
	deletedRows, total, err := QueryUsers(UserQueryFilter{Status: &deletedStatus}, "id", "asc", 0, 50)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, []int{removed.Id}, collectRowIDs(deletedRows))
}

// TestCollectUserIdsByFilterRespectsLimit guards the bulk-action bound: a broad
// filter must never return more targets than the caller allows.
func TestCollectUserIdsByFilterRespectsLimit(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	for id := 31; id <= 35; id++ {
		seedAnalyticsUser(t, id, today, RegisterSourcePassword, "")
	}

	userIDs, err := CollectUserIdsByFilter(UserQueryFilter{}, 3)
	require.NoError(t, err)
	assert.Equal(t, []int{31, 32, 33}, userIDs)
}

// TestCollectUserEmailsSkipsUndeliverableUsers keeps campaign delivery from
// targeting disabled accounts or users with no address on file.
func TestCollectUserEmailsSkipsUndeliverableUsers(t *testing.T) {
	truncateTables(t)

	today := StartOfLocalDay(time.Now())
	reachable := seedAnalyticsUser(t, 41, today, RegisterSourcePassword, "")
	disabled := seedAnalyticsUser(t, 42, today, RegisterSourcePassword, "")
	noEmail := seedAnalyticsUser(t, 43, today, RegisterSourcePassword, "")

	require.NoError(t, DB.Model(&User{}).Where("id = ?", reachable.Id).Update("email", "reach@example.com").Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", disabled.Id).
		Updates(map[string]interface{}{"email": "off@example.com", "status": common.UserStatusDisabled}).Error)

	emails, err := CollectUserEmails([]int{reachable.Id, disabled.Id, noEmail.Id})
	require.NoError(t, err)
	assert.Equal(t, []string{"reach@example.com"}, emails)
}
