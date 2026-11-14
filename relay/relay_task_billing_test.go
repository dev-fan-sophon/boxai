package relay

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeTaskReservation stands in for the session the first attempt created;
// limit is the most the wallet can hold.
type fakeTaskReservation struct {
	held, limit int
	reserves    []int
}

func (f *fakeTaskReservation) Settle(int) error         { return nil }
func (f *fakeTaskReservation) Refund(*gin.Context)      {}
func (f *fakeTaskReservation) NeedsRefund() bool        { return f.held > 0 }
func (f *fakeTaskReservation) GetPreConsumedQuota() int { return f.held }
func (f *fakeTaskReservation) Reserve(target int) error {
	f.reserves = append(f.reserves, target)
	if target <= f.held {
		return nil
	}
	if target > f.limit {
		return types.NewErrorWithStatusCode(errors.New("wallet quota insufficient"), types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	f.held = target
	return nil
}

func TestReserveTaskAttemptBillingHoldsRetryPriceBeforeSubmission(t *testing.T) {
	for _, tc := range []struct {
		name      string
		quota     int
		free      bool
		limit     int
		wantHeld  int
		wantCode  string
		wantError bool
	}{
		{name: "pricier retry raises the reservation", quota: 400, limit: 1000, wantHeld: 400},
		{name: "cheaper retry keeps the existing reservation", quota: 50, limit: 1000, wantHeld: 100},
		{name: "free retry keeps the existing reservation for settlement", quota: 0, free: true, limit: 1000, wantHeld: 100},
		{name: "unaffordable retry is rejected before submission", quota: 400, limit: 300, wantHeld: 100, wantCode: string(types.ErrorCodeInsufficientUserQuota), wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			billing := &fakeTaskReservation{held: 100, limit: tc.limit}
			info := &relaycommon.RelayInfo{Billing: billing}
			info.PriceData.Quota = tc.quota
			info.PriceData.FreeModel = tc.free

			taskErr := reserveTaskAttemptBilling(c, info)
			assert.Equal(t, []int{tc.quota}, billing.reserves)
			assert.Equal(t, tc.wantHeld, billing.held)
			if !tc.wantError {
				assert.Nil(t, taskErr)
				return
			}
			require.NotNil(t, taskErr)
			assert.Equal(t, tc.wantCode, taskErr.Code)
			assert.Equal(t, http.StatusForbidden, taskErr.StatusCode)
			assert.True(t, taskErr.LocalError, "a local funding failure must not be retried on another channel")
		})
	}
}
