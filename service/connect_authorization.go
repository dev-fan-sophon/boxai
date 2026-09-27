package service

import (
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"gorm.io/gorm"
)

var ErrConnectInvalidGrant = errors.New("invalid connect grant")

func CreateConnectAuthorization(redirect, challenge, method, state, name string) (*model.ConnectAuthorization, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(challenge)
	if err != nil || len(decoded) != 32 || len(challenge) != 43 || method != "S256" || !validPKCEValue(state, 22, 128) || validateConnectorRedirect(redirect) != nil {
		return nil, ErrConnectInvalidGrant
	}
	id, err := opaque(24)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "BoxAI Connect"
	}
	if len(name) > 100 {
		return nil, ErrConnectInvalidGrant
	}
	a := &model.ConnectAuthorization{ID: id, RedirectURI: redirect, CodeChallenge: challenge, State: state, ClientName: name, Status: "pending", ExpiresAt: time.Now().Unix() + 600}
	return a, model.DB.Create(a).Error
}

func GetConnectAuthorization(id string) (*model.ConnectAuthorization, error) {
	var a model.ConnectAuthorization
	if err := model.DB.Where("id = ? AND expires_at > ?", id, time.Now().Unix()).First(&a).Error; err != nil {
		return nil, ErrConnectInvalidGrant
	}
	return &a, nil
}

func DecideConnectAuthorization(id string, userID int, approve bool) (string, *model.ConnectAuthorization, error) {
	a, err := GetConnectAuthorization(id)
	if err != nil {
		return "", nil, err
	}
	var user model.User
	if userID <= 0 || model.DB.Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error != nil {
		return "", nil, ErrConnectInvalidGrant
	}
	status, code := "denied", ""
	updates := map[string]any{"status": status, "user_id": userID}
	if approve {
		code, err = opaque(32)
		if err != nil {
			return "", nil, err
		}
		status = "approved"
		updates["status"], updates["code_hash"] = status, secretHash(code)
	}
	r := model.DB.Model(&model.ConnectAuthorization{}).Where("id = ? AND status = ? AND expires_at > ?", id, "pending", time.Now().Unix()).Updates(updates)
	if r.Error != nil {
		return "", nil, r.Error
	}
	if r.RowsAffected != 1 {
		return "", nil, ErrConnectInvalidGrant
	}
	a.Status, a.UserID = status, userID
	return code, a, nil
}

func ExchangeConnectCode(code, verifier, redirect string) (string, error) {
	if !validPKCEValue(code, 43, 43) || !validPKCEValue(verifier, 43, 128) || validateConnectorRedirect(redirect) != nil {
		return "", ErrConnectInvalidGrant
	}
	var key string
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		// Write first: serialize SQLite writers and atomically claim the grant on
		// every supported database. Any subsequent failure rolls consumption back.
		r := tx.Model(&model.ConnectAuthorization{}).Where("code_hash = ? AND code_challenge = ? AND redirect_uri = ? AND status = ? AND expires_at > ?", secretHash(code), secretHash(verifier), redirect, "approved", time.Now().Unix()).Update("status", "consumed")
		if r.Error != nil {
			return r.Error
		}
		if r.RowsAffected != 1 {
			return ErrConnectInvalidGrant
		}
		var a model.ConnectAuthorization
		if err := tx.Where("code_hash = ?", secretHash(code)).First(&a).Error; err != nil {
			return err
		}
		// MySQL installations may use case-insensitive varchar collations.
		// Recheck secrets byte-for-byte before issuing a credential.
		if a.CodeHash == nil || subtle.ConstantTimeCompare([]byte(*a.CodeHash), []byte(secretHash(code))) != 1 || subtle.ConstantTimeCompare([]byte(a.CodeChallenge), []byte(secretHash(verifier))) != 1 || a.RedirectURI != redirect {
			return ErrConnectInvalidGrant
		}
		var user model.User
		if err := tx.Where("id = ? AND status = ?", a.UserID, common.UserStatusEnabled).First(&user).Error; err != nil {
			return ErrConnectInvalidGrant
		}
		var err error
		key, err = common.GenerateKey()
		if err != nil {
			return err
		}
		now := common.GetTimestamp()
		return tx.Create(&model.Token{UserId: user.Id, Name: "BoxAI Connect", Key: key, Status: common.TokenStatusEnabled, CreatedTime: now, AccessedTime: now, ExpiredTime: -1, UnlimitedQuota: true}).Error
	})
	if err != nil {
		return "", err
	}
	return "sk-" + key, nil
}
