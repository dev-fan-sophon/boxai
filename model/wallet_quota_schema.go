package model

import (
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
)

// walletQuotaColumns hold wallet balances, lifetime totals and token limits.
// They must be 64-bit so a balance can grow past the int32 range that bounds a
// single request's charge (common.MaxQuota) up to common.MaxWalletQuota.
var walletQuotaColumns = []struct {
	table   string
	columns []string
}{
	{table: "users", columns: []string{"quota", "used_quota", "aff_quota", "aff_history", "reward_quota", "reward_history"}},
	{table: "tokens", columns: []string{"remain_quota", "used_quota"}},
}

// narrowIntegerTypes are the information_schema DATA_TYPE values of integer
// columns smaller than 64 bits on MySQL and PostgreSQL.
var narrowIntegerTypes = map[string]bool{
	"tinyint":   true,
	"smallint":  true,
	"mediumint": true,
	"int":       true,
	"integer":   true,
}

type walletColumnInfo struct {
	ColumnName    string  `gorm:"column:column_name"`
	DataType      string  `gorm:"column:data_type"`
	IsNullable    string  `gorm:"column:is_nullable"`
	ColumnDefault *string `gorm:"column:column_default"`
}

// migrateWalletQuotaColumnsToBigint widens legacy 32-bit wallet columns before
// AutoMigrate runs. Older schemas declared users.quota and its siblings as
// `int`, which caps a wallet at about 4,294 USD and makes lifetime totals such
// as used_quota fail with an out-of-range error once they cross it. SQLite
// INTEGER columns are already 64-bit, so only MySQL and PostgreSQL need work.
// A failed ALTER stops startup: running 64-bit wallet code on a 32-bit column
// would reject legitimate top-ups and settlements at runtime instead.
func migrateWalletQuotaColumnsToBigint() error {
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return nil
	}
	postgres := common.UsingMainDatabase(common.DatabaseTypePostgreSQL)
	if !postgres && !common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return nil
	}
	for _, target := range walletQuotaColumns {
		if !DB.Migrator().HasTable(target.table) {
			continue
		}
		var infos []walletColumnInfo
		schemaFilter := "table_schema = DATABASE()"
		if postgres {
			schemaFilter = "table_schema = current_schema()"
		}
		err := DB.Raw(`SELECT column_name AS column_name, data_type AS data_type,
				is_nullable AS is_nullable, column_default AS column_default
			FROM information_schema.columns
			WHERE `+schemaFilter+` AND table_name = ? AND column_name IN ?`,
			target.table, target.columns).Scan(&infos).Error
		if err != nil {
			return fmt.Errorf("inspect %s wallet columns: %w", target.table, err)
		}

		var clauses, widened []string
		for _, info := range infos {
			if !narrowIntegerTypes[strings.ToLower(strings.TrimSpace(info.DataType))] {
				continue
			}
			widened = append(widened, info.ColumnName)
			if postgres {
				clauses = append(clauses, fmt.Sprintf(`ALTER COLUMN "%s" TYPE bigint`, info.ColumnName))
				continue
			}
			clause := fmt.Sprintf("MODIFY COLUMN `%s` bigint", info.ColumnName)
			if strings.EqualFold(info.IsNullable, "NO") {
				clause += " NOT NULL"
			}
			// MODIFY COLUMN rewrites the whole definition; every wallet column
			// model declares default:0, so that is the default to keep.
			if info.ColumnDefault != nil {
				clause += " DEFAULT 0"
			}
			clauses = append(clauses, clause)
		}
		if len(clauses) == 0 {
			continue
		}

		table := "`" + target.table + "`"
		if postgres {
			table = `"` + target.table + `"`
		}
		alterSQL := fmt.Sprintf("ALTER TABLE %s %s", table, strings.Join(clauses, ", "))
		if err := DB.Exec(alterSQL).Error; err != nil {
			return fmt.Errorf("widen %s.%v to bigint: %w", target.table, widened, err)
		}
		common.SysLog(fmt.Sprintf("migrated %s.%v to bigint", target.table, widened))
	}
	return nil
}
