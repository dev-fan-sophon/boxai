package model

import (
	"errors"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
)

// SystemNoticeListLimit bounds how many published notices clients receive.
const SystemNoticeListLimit = 20

// SystemNoticeMaxLength bounds a single notice body.
const SystemNoticeMaxLength = 20000

// SystemNotice is one published site notice. Publishing appends a row so a
// new notice never replaces an older one; the "Notice" option mirrors the
// newest content for clients that still read GET /api/notice.
type SystemNotice struct {
	Id        int    `json:"id"`
	Content   string `json:"content" gorm:"type:text"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index"`
}

func ListSystemNotices(limit int) ([]SystemNotice, error) {
	var notices []SystemNotice
	err := DB.Order("id desc").Limit(limit).Find(&notices).Error
	return notices, err
}

func CreateSystemNotice(content string) (*SystemNotice, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, errors.New("notice content is empty")
	}
	if len(content) > SystemNoticeMaxLength {
		return nil, errors.New("notice content is too long")
	}
	notice := &SystemNotice{Content: content, CreatedAt: common.GetTimestamp()}
	if err := DB.Create(notice).Error; err != nil {
		return nil, err
	}
	return notice, syncNoticeOption()
}

func DeleteSystemNotice(id int) error {
	result := DB.Delete(&SystemNotice{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("notice not found")
	}
	return syncNoticeOption()
}

// syncNoticeOption keeps the legacy single "Notice" option equal to the
// newest published notice.
func syncNoticeOption() error {
	latest, err := ListSystemNotices(1)
	if err != nil {
		return err
	}
	content := ""
	if len(latest) > 0 {
		content = latest[0].Content
	}
	return UpdateOption("Notice", content)
}

// seedSystemNoticesFromOption carries a notice saved before notice history
// existed into the history table, once.
func seedSystemNoticesFromOption() error {
	var count int64
	if err := DB.Model(&SystemNotice{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	var option Option
	err := DB.Where(commonKeyCol+" = ?", "Notice").Limit(1).Find(&option).Error
	if err != nil {
		return err
	}
	content := strings.TrimSpace(option.Value)
	if content == "" {
		return nil
	}
	return DB.Create(&SystemNotice{Content: content, CreatedAt: common.GetTimestamp()}).Error
}
