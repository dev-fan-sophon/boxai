package model

import (
	"github.com/dev-fan-sophon/boxai/common"
	"gorm.io/gorm"
)

// GetDBTimestamp returns a UNIX timestamp from database time.
// Falls back to application time on error.
func GetDBTimestamp() int64 {
	return dbTimestamp(DB)
}

// dbTimestamp reads the database time through the given handle. Callers inside
// a transaction must pass their tx: querying via the global pool would grab a
// second connection and deadlock single-connection SQLite.
func dbTimestamp(db *gorm.DB) int64 {
	if db == nil {
		return common.GetTimestamp()
	}
	var ts int64
	var err error
	switch {
	case common.UsingMainDatabase(common.DatabaseTypePostgreSQL):
		err = db.Raw("SELECT EXTRACT(EPOCH FROM NOW())::bigint").Scan(&ts).Error
	case common.UsingMainDatabase(common.DatabaseTypeSQLite):
		err = db.Raw("SELECT strftime('%s','now')").Scan(&ts).Error
	default:
		err = db.Raw("SELECT UNIX_TIMESTAMP()").Scan(&ts).Error
	}
	if err != nil || ts <= 0 {
		return common.GetTimestamp()
	}
	return ts
}
