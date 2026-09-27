package model

// ConnectAuthorization stores only a short-lived PKCE grant, never a session.
type ConnectAuthorization struct {
	ID            string `gorm:"type:varchar(64);primaryKey"`
	RedirectURI   string `gorm:"type:varchar(255);not null"`
	CodeChallenge string `gorm:"type:varchar(64);not null"`
	State         string `gorm:"type:varchar(128);not null"`
	ClientName    string `gorm:"type:varchar(100)"`
	Status        string `gorm:"type:varchar(16);not null"`
	UserID        int
	CodeHash      *string `gorm:"type:varchar(64);uniqueIndex"`
	ExpiresAt     int64   `gorm:"index"`
}
