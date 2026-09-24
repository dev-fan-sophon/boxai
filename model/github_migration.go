package model

import (
	"errors"

	"gorm.io/gorm"
)

// MigrateLegacyGitHubID compares both the binding and the email evidence at
// write time. A concurrent unlink, email change or migration must fail closed.
func (user *User) MigrateLegacyGitHubID(numericID string) error {
	if user.Id <= 0 || user.GitHubId == "" || NormalizeEmail(user.Email) == "" || numericID == "" {
		return errors.New("invalid GitHub migration")
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var current User
		if err := lockForUpdate(tx).First(&current, user.Id).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Unscoped().Model(&User{}).Where("github_id = ?", numericID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errors.New("GitHub identity already bound; retry sign in")
		}
		result := tx.Model(&User{}).Where("id = ? AND github_id = ? AND email = ?", user.Id, user.GitHubId, user.Email).Update("github_id", numericID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("GitHub identity changed during migration; retry sign in")
		}
		current.GitHubId = numericID
		*user = current
		return nil
	})
	return err
}
