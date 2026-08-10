package model

import (
	"errors"

	"gorm.io/gorm"
)

type ConnectorCatalogState struct {
	ID       int   `gorm:"primaryKey;autoIncrement:false"`
	Revision int64 `gorm:"not null"`
}

type ConnectorMCPServer struct {
	ID            string `json:"id" gorm:"type:varchar(64);primaryKey"`
	Name          string `json:"name" gorm:"type:varchar(128);not null"`
	URL           string `json:"url" gorm:"type:varchar(2048);not null"`
	Authorization string `json:"authorization" gorm:"type:varchar(32);not null"`
	Description   string `json:"description" gorm:"type:text"`
	Enabled       bool   `json:"enabled" gorm:"index"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
}

type ConnectorSkillRelease struct {
	ID                   string `json:"id" gorm:"type:varchar(64);primaryKey;autoIncrement:false"`
	Version              string `json:"version" gorm:"type:varchar(64);primaryKey;autoIncrement:false"`
	Name                 string `json:"name" gorm:"type:varchar(128);not null"`
	ArchiveURL           string `json:"archive_url" gorm:"type:varchar(2048);not null"`
	ArchiveSHA256        string `json:"archive_sha256" gorm:"type:varchar(64);not null"`
	ArchiveSizeBytes     int64  `json:"archive_size_bytes" gorm:"not null"`
	ArchiveFormat        string `json:"archive_format" gorm:"type:varchar(16);not null"`
	ArchiveAuthorization string `json:"archive_authorization" gorm:"type:varchar(32);not null"`
	Enabled              bool   `json:"enabled" gorm:"index"`
	CreatedAt            int64  `json:"created_at"`
	UpdatedAt            int64  `json:"updated_at"`
}

// WithConnectorCatalogMutation serializes catalog count/invariant checks with
// their write. Updating the singleton is the transaction's first statement, so
// it acquires a current write lock without establishing a stale MySQL snapshot.
func WithConnectorCatalogMutation(mutate func(tx *gorm.DB) error) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&ConnectorCatalogState{}).Where("id = ?", 1).
			UpdateColumn("revision", gorm.Expr("revision + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("connector catalog state is missing")
		}
		return mutate(tx)
	})
}

func ListConnectorMCPServers(enabledOnly bool) ([]ConnectorMCPServer, error) {
	servers := make([]ConnectorMCPServer, 0)
	query := DB.Order("id ASC")
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&servers).Error
	return servers, err
}

func ListConnectorSkillReleases(enabledOnly bool) ([]ConnectorSkillRelease, error) {
	releases := make([]ConnectorSkillRelease, 0)
	query := DB.Order("id ASC, version ASC")
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&releases).Error
	return releases, err
}
