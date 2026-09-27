// Package migration restores authenticated Rust Connector projections before
// the new client takes ownership. Secrets are supplied by the native vault and
// never copied to the new profile, cache, receipt, or journal.
package migration

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/yetone/magpie/internal/edit"
)

// SecretResolver reads the ORIGINAL native credential, not a newly issued
// login token. The caller retains the vault entry until Restore succeeds.
type SecretResolver func(credential string) ([]byte, error)

type Profile struct {
	ID            string                     `json:"id"`
	SchemaVersion int                        `json:"schema_version"`
	Platform      string                     `json:"platform_id"`
	Credential    string                     `json:"credential"`
	Agents        map[string]json.RawMessage `json:"agents"`
}
type legacyFile struct {
	Path     string `json:"path"`
	Original []byte `json:"original"`
	Applied  []byte `json:"applied"`
}
type legacyReceipt struct {
	Platform string        `json:"platform_id"`
	Files    []legacyFile  `json:"files"`
	Skills   []legacySkill `json:"skills"`
	Leases   []edit.Lease  `json:"leases"`
}

// Restore returns the original agent choices for the application to import
// only after a successful restore. It preserves profiles, vault entries and
// encrypted backups. LegacyState is the old application data directory (the
// receipts are in connector/receipts). AllowedRoots must come from local agent
// discovery/user selection, not an untrusted receipt. Retired agents are valid.
func Restore(profilesPath, legacyState, newState, coordinator string, allowedRoots []string, resolve SecretResolver) ([]Profile, error) {
	b, err := read(profilesPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var store struct {
		Profiles []Profile `json:"profiles"`
	}
	if err = json.Unmarshal(b, &store); err != nil {
		return nil, errors.New("invalid legacy profiles; retain profiles.json and native vault entry for recovery")
	}
	for _, p := range store.Profiles {
		if p.SchemaVersion < 1 || p.SchemaVersion > 3 {
			return nil, errors.New("unsupported legacy profile version; preserve profiles.json and its native credential")
		}
		if p.Platform == "" || p.Platform != filepath.Base(p.Platform) || strings.ContainsAny(p.Platform, "/\\") {
			return nil, errors.New("invalid legacy platform identity")
		}
	}
	projection := edit.Projection{StateDir: newState, CoordinatorDir: coordinator}
	err = projection.Locked(func() error {
		ownershipPath := filepath.Join(coordinator, "ownership.json")
		owned, err := read(ownershipPath)
		if errors.Is(err, os.ErrNotExist) {
			owned = nil
		} else if err != nil {
			return err
		}
		var ownership edit.Ownership
		if owned != nil && json.Unmarshal(owned, &ownership) != nil {
			return errors.New("invalid neutral ownership record")
		}
		var changes []edit.Change
		for _, profile := range store.Profiles {
			path := filepath.Join(legacyState, "connector", "receipts", profile.Platform+".json")
			sealed, e := read(path)
			if errors.Is(e, os.ErrNotExist) {
				continue
			}
			if e != nil {
				return e
			}
			if resolve == nil {
				return errors.New("legacy native credential resolver required; keep the original vault entry")
			}
			secret, e := resolve(profile.Credential)
			if e != nil {
				return fmt.Errorf("legacy credential unavailable for profile %s; retain native vault and retry", profile.ID)
			}
			r, e := openReceipt(sealed, secret)
			clear(secret)
			if e != nil {
				return e
			}
			if r.Platform != profile.Platform {
				return errors.New("legacy receipt belongs to another platform")
			}
			if len(r.Leases) == 0 && (len(r.Files) > 0 || len(r.Skills) > 0) {
				return errors.New("legacy receipt lacks ownership leases; preserve its vault entry and restore using its matching Connect version")
			}
			for _, s := range r.Skills {
				if !allowed(s.Path, allowedRoots) {
					return fmt.Errorf("legacy skill path not approved: %s", s.Path)
				}
				restore, e := restoreSkill(s)
				if e != nil {
					return e
				}
				changes = append(changes, restore...)
			}
			for _, lease := range r.Leases {
				if lease.Platform != r.Platform || !allowed(lease.Root, allowedRoots) {
					return errors.New("legacy lease root not approved; select its original agent directory before migration")
				}
				found := false
				for _, l := range ownership.Leases {
					if l == lease {
						found = true
					}
				}
				if !found {
					return errors.New("legacy ownership lease missing or changed; migration blocked without overwriting configs")
				}
			}
			for _, f := range r.Files {
				if !allowed(f.Path, allowedRoots) {
					return fmt.Errorf("legacy config path not approved: %s", f.Path)
				}
				now, e := read(f.Path)
				if errors.Is(e, os.ErrNotExist) {
					now = nil
				} else if e != nil {
					return e
				}
				restored, e := edit.RestoreBytes(f.Path, f.Original, f.Applied, now)
				if e != nil {
					return e
				}
				changes = append(changes, edit.Change{Path: f.Path, Before: now, After: restored})
			}
			// Keep authenticated originals, including backups, for manual audit.
			backupPath := path + ".migrated"
			old, e := read(backupPath)
			if e != nil && !errors.Is(e, os.ErrNotExist) {
				return e
			}
			if old != nil && !bytes.Equal(old, sealed) {
				return errors.New("migration backup conflict; preserve both records")
			}
			changes = append(changes, edit.Change{Path: backupPath, Before: old, After: sealed}, edit.Change{Path: path, Before: sealed, After: nil})
			kept := []edit.Lease{}
			for _, l := range ownership.Leases {
				remove := false
				for _, lease := range r.Leases {
					if l == lease {
						remove = true
					}
				}
				if !remove {
					kept = append(kept, l)
				}
			}
			ownership.Leases = kept
		}
		if len(changes) == 0 {
			return nil
		}
		after, e := json.Marshal(ownership)
		if e != nil {
			return e
		}
		changes = append(changes, edit.Change{Path: ownershipPath, Before: owned, After: after})
		return projection.Commit(changes)
	})
	if err != nil {
		return nil, err
	}
	return store.Profiles, nil
}
func allowed(path string, roots []string) bool {
	if !filepath.IsAbs(path) {
		return false
	}
	for _, root := range roots {
		if !filepath.IsAbs(root) {
			continue
		}
		rel, err := filepath.Rel(root, path)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}
func read(path string) ([]byte, error) {
	if err := edit.PlainPath(path); err != nil {
		return nil, err
	}
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.Size() > 32<<20 {
		return nil, errors.New("legacy record exceeds recovery size limit")
	}
	return os.ReadFile(path)
}
func openReceipt(b, secret []byte) (legacyReceipt, error) {
	var out legacyReceipt
	var sealed struct {
		Nonce      []byte `json:"nonce"`
		Ciphertext []byte `json:"ciphertext"`
	}
	if json.Unmarshal(b, &sealed) != nil || len(sealed.Nonce) != 12 || len(secret) == 0 {
		return out, errors.New("invalid legacy encrypted receipt; preserve original record and vault credential")
	}
	key, err := hkdf.Key(sha256.New, secret, []byte("Gateway Connector receipt v2"), "authenticated receipt", 32)
	if err != nil {
		return out, err
	}
	defer clear(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		return out, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return out, err
	}
	plain, err := gcm.Open(nil, sealed.Nonce, sealed.Ciphertext, nil)
	if err != nil {
		return out, errors.New("legacy receipt authentication failed; recover the ORIGINAL native vault credential before retrying")
	}
	defer clear(plain)
	decoder := json.NewDecoder(bytes.NewReader(plain))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&out) != nil {
		return out, errors.New("unsupported legacy receipt payload; preserve it for recovery")
	}
	return out, nil
}
