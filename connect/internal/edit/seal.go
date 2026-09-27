package edit

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
)

// Local recovery encryption is independent of the BoxAI root credential.
// The random key is private application state, not a provider/API credential.
func (p *Projection) recoveryCipher(create bool) (cipher.AEAD, error) {
	path := filepath.Join(p.StateDir, "projection-key")
	b, err := diskRead(path)
	if err != nil {
		return nil, err
	}
	if b == nil && create {
		b = make([]byte, 32)
		if _, err = rand.Read(b); err != nil {
			return nil, err
		}
		if err = writeAtomic(path, b); err != nil {
			return nil, err
		}
		if err = os.Chmod(path, 0600); err != nil {
			return nil, err
		}
	}
	if len(b) != 32 {
		return nil, errors.New("recovery encryption key missing or invalid; preserve projection state for recovery")
	}
	defer clear(b)
	block, err := aes.NewCipher(b)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func (p *Projection) seal(b []byte) ([]byte, error) {
	c, e := p.recoveryCipher(true)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, c.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return c.Seal(nonce, nonce, b, []byte("BoxAI projection v1")), nil
}
func (p *Projection) open(b []byte) ([]byte, error) {
	c, e := p.recoveryCipher(false)
	if e != nil {
		return nil, e
	}
	if len(b) < c.NonceSize() {
		return nil, errors.New("invalid encrypted projection record")
	}
	out, e := c.Open(nil, b[:c.NonceSize()], b[c.NonceSize():], []byte("BoxAI projection v1"))
	if e != nil {
		return nil, errors.New("projection record authentication failed; preserve state for recovery")
	}
	return out, nil
}
