package model

import (
	"os"
	"strings"
	"testing"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// The external-database tests create and drop `users` and `tokens`, so they
// refuse to run against a database that already has either table.
func TestWalletQuotaColumnsMigrateToBigintPostgres(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set TEST_POSTGRES_DSN to an empty scratch database to run the postgres wallet migration test")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	runWalletQuotaMigrationTest(t, db, common.DatabaseTypePostgreSQL, []string{
		`CREATE TABLE users (id bigserial PRIMARY KEY, username varchar(64), quota integer DEFAULT 0,
			used_quota integer DEFAULT 0, aff_quota integer DEFAULT 0, aff_history integer DEFAULT 0,
			reward_quota integer DEFAULT 0, reward_history integer NOT NULL DEFAULT 0, deleted_at timestamptz)`,
		`CREATE TABLE tokens (id bigserial PRIMARY KEY, remain_quota integer DEFAULT 0, used_quota bigint DEFAULT 0)`,
	})
}

func TestWalletQuotaColumnsMigrateToBigintMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("set TEST_MYSQL_DSN to an empty scratch database to run the mysql wallet migration test")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	runWalletQuotaMigrationTest(t, db, common.DatabaseTypeMySQL, []string{
		"CREATE TABLE users (id bigint AUTO_INCREMENT PRIMARY KEY, username varchar(64), quota int DEFAULT 0, " +
			"used_quota int DEFAULT 0, aff_quota int DEFAULT 0, aff_history int DEFAULT 0, " +
			"reward_quota int DEFAULT 0, reward_history int NOT NULL DEFAULT 0, deleted_at datetime(3) NULL)",
		"CREATE TABLE tokens (id bigint AUTO_INCREMENT PRIMARY KEY, remain_quota int DEFAULT 0, used_quota bigint DEFAULT 0)",
	})
}

func runWalletQuotaMigrationTest(t *testing.T, db *gorm.DB, dbType common.DatabaseType, legacyDDL []string) {
	t.Helper()
	if db.Migrator().HasTable("users") || db.Migrator().HasTable("tokens") {
		t.Skip("scratch database already has users or tokens; refusing to modify it")
	}
	oldDB, oldMain, oldLog := DB, common.MainDatabaseType(), common.LogDatabaseType()
	DB = db
	common.SetDatabaseTypes(dbType, dbType)
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable("tokens", "users"))
		DB = oldDB
		common.SetDatabaseTypes(oldMain, oldLog)
	})
	for _, ddl := range legacyDDL {
		require.NoError(t, db.Exec(ddl).Error)
	}
	require.NoError(t, db.Exec("INSERT INTO users (username, quota, used_quota, reward_history) VALUES ('legacy', 123, 456, 7)").Error)

	// A legacy 32-bit column rejects a wallet balance past the int32 range.
	require.Error(t, db.Exec("UPDATE users SET quota = ? WHERE username = 'legacy'", int64(common.MaxQuota)+1).Error)

	require.NoError(t, migrateWalletQuotaColumnsToBigint())
	for _, column := range []string{"quota", "used_quota", "aff_quota", "aff_history", "reward_quota", "reward_history"} {
		assert.Equal(t, "bigint", walletColumnDataType(t, db, dbType, "users", column), column)
	}
	assert.Equal(t, "bigint", walletColumnDataType(t, db, dbType, "tokens", "remain_quota"))
	assert.True(t, walletColumnNotNull(t, db, dbType, "users", "reward_history"), "NOT NULL must survive the migration")
	assert.False(t, walletColumnNotNull(t, db, dbType, "users", "quota"))

	var legacy User
	require.NoError(t, db.Select("quota", "used_quota", "reward_history").Where("username = ?", "legacy").First(&legacy).Error)
	assert.Equal(t, 123, legacy.Quota)
	assert.Equal(t, 456, legacy.UsedQuota)
	assert.Equal(t, 7, legacy.RewardHistory)

	require.NoError(t, db.Exec("INSERT INTO users (username) VALUES ('defaults')").Error)
	var defaults User
	require.NoError(t, db.Select("quota", "reward_history").Where("username = ?", "defaults").First(&defaults).Error)
	assert.Zero(t, defaults.Quota, "DEFAULT 0 must survive the migration")
	assert.Zero(t, defaults.RewardHistory)

	beyondInt32 := common.MaxQuota + 1_000
	require.NoError(t, db.Exec("UPDATE users SET quota = ? WHERE username = 'legacy'", beyondInt32).Error)
	require.NoError(t, db.Select("quota").Where("username = ?", "legacy").First(&legacy).Error)
	assert.Equal(t, beyondInt32, legacy.Quota)

	// A second startup finds nothing to widen, and AutoMigrate keeps the columns 64-bit.
	require.NoError(t, migrateWalletQuotaColumnsToBigint())
	// The legacy fixture omits NOT NULL columns such as password, which
	// AutoMigrate cannot add to a table that still has rows.
	require.NoError(t, db.Exec("DELETE FROM users").Error)
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}))
	assert.Equal(t, "bigint", walletColumnDataType(t, db, dbType, "users", "quota"))
	assert.Equal(t, "bigint", walletColumnDataType(t, db, dbType, "tokens", "remain_quota"))
}

func walletColumnDataType(t *testing.T, db *gorm.DB, dbType common.DatabaseType, table, column string) string {
	t.Helper()
	return strings.ToLower(walletColumnInfoFor(t, db, dbType, table, column).DataType)
}

func walletColumnNotNull(t *testing.T, db *gorm.DB, dbType common.DatabaseType, table, column string) bool {
	t.Helper()
	return strings.EqualFold(walletColumnInfoFor(t, db, dbType, table, column).IsNullable, "NO")
}

func walletColumnInfoFor(t *testing.T, db *gorm.DB, dbType common.DatabaseType, table, column string) walletColumnInfo {
	t.Helper()
	schemaFilter := "table_schema = DATABASE()"
	if dbType == common.DatabaseTypePostgreSQL {
		schemaFilter = "table_schema = current_schema()"
	}
	var info walletColumnInfo
	require.NoError(t, db.Raw(`SELECT column_name AS column_name, data_type AS data_type, is_nullable AS is_nullable
		FROM information_schema.columns WHERE `+schemaFilter+` AND table_name = ? AND column_name = ?`,
		table, column).Scan(&info).Error)
	require.NotEmpty(t, info.ColumnName, "%s.%s not found", table, column)
	return info
}
