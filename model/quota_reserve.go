package model

import (
	"errors"

	"github.com/dev-fan-sophon/boxai/common"
	"gorm.io/gorm"
)

// TryReserveUserQuota atomically checks and deducts wallet quota in the
// database. Redis is only a read cache: an expiring cache cannot safely be the
// authority for spendable balance.
func TryReserveUserQuota(id int, quota int) (bool, error) {
	if quota < 0 {
		return false, errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return true, nil
	}
	result := DB.Model(&User{}).
		Where("id = ? AND quota >= ?", id, quota).
		Update("quota", gorm.Expr("quota - ?", quota))
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		if err := invalidateUserCache(id); err != nil {
			common.SysLog("failed to invalidate user cache after quota reservation: " + err.Error())
		}
		return true, nil
	}
	return false, nil
}

// TryReserveTokenQuota atomically checks and deducts token quota in the
// database. The database's unlimited flag remains authoritative even when a
// caller obtained token metadata from Redis before a concurrent update.
func TryReserveTokenQuota(id int, key string, quota int, _ bool) (bool, error) {
	if quota < 0 {
		return false, errors.New("quota 不能为负数！")
	}
	if quota == 0 {
		return true, nil
	}
	result := DB.Model(&Token{}).
		Where(map[string]interface{}{"id": id, "key": key}).
		Where("unlimited_quota = ? OR remain_quota >= ?", true, quota).
		Updates(map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota - ?", quota),
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"accessed_time": common.GetTimestamp(),
		})
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 1 {
		if err := invalidateTokenCacheForMutation(key); err != nil {
			common.SysLog("failed to invalidate token cache after quota reservation: " + err.Error())
		}
		return true, nil
	}
	return false, nil
}
