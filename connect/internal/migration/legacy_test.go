package migration

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/edit"
)

// Golden generated independently with Python hmac/hashlib and cryptography's
// AESGCM, using the Rust HKDF constants and Rust's numeric byte-array JSON.
func TestLegacyRustReceiptGolden(t *testing.T) {
	golden := []byte(`{"nonce":[0,1,2,3,4,5,6,7,8,9,10,11],"ciphertext":[141,49,204,212,164,0,193,91,187,252,106,195,53,138,118,230,161,254,234,23,184,246,166,148,227,137,33,234,162,138,22,198,255,252,250,201,49,186,88,75,210,112,106,67,180,84,69,159,255,137,119,125,196,67,2,165,196,247,114,46,236,58,219,82,57,72,123,55,86,39,152,159,28,114]}`)
	r, err := openReceipt(golden, []byte("legacy-test-secret"))
	require.NoError(t, err)
	assert.Equal(t, "boxai", r.Platform)
	_, err = openReceipt(golden, []byte("new-login-token"))
	assert.ErrorContains(t, err, "ORIGINAL")
}

func TestLegacyRestoreCurrentReceiptAndRetiredAgent(t *testing.T) {
	for _, external := range []bool{false, true} {
		t.Run(map[bool]string{false: "restore", true: "conflict"}[external], func(t *testing.T) {
			d := t.TempDir()
			legacy := filepath.Join(d, "old")
			state := filepath.Join(d, "new")
			coordinator := filepath.Join(d, "neutral")
			root := filepath.Join(d, ".workbuddy")
			config := filepath.Join(root, "settings.json")
			profiles := filepath.Join(legacy, "profiles.json")
			before := []byte(`{"env":{"API_KEY":"original"},"unrelated":1}`)
			applied := []byte(`{"env":{"API_KEY":"legacy-root-secret"},"unrelated":1}`)
			lease := edit.Lease{Platform: "boxai", Agent: "workbuddy", Root: root}
			r := legacyReceipt{Platform: "boxai", Files: []legacyFile{{config, before, applied}}, Leases: []edit.Lease{lease}}
			plain, err := json.Marshal(r)
			require.NoError(t, err)
			secret := []byte("legacy-test-secret")
			key, err := hkdf.Key(sha256.New, secret, []byte("Gateway Connector receipt v2"), "authenticated receipt", 32)
			require.NoError(t, err)
			block, err := aes.NewCipher(key)
			require.NoError(t, err)
			gcm, err := cipher.NewGCM(block)
			require.NoError(t, err)
			nonce := make([]byte, 12)
			ciphertext := gcm.Seal(nil, nonce, plain, nil)
			sealed, err := json.Marshal(map[string]any{"nonce": nonce, "ciphertext": ciphertext})
			require.NoError(t, err)
			receipt := filepath.Join(legacy, "connector", "receipts", "boxai.json")
			require.NoError(t, edit.WriteAtomic(receipt, sealed))
			require.NoError(t, edit.WriteAtomic(profiles, []byte(`{"profiles":[{"schema_version":3,"id":"profile-id","platform_id":"boxai","credential":"native-account","agents":{"workbuddy":{"enabled":true}}}]}`)))
			owned, err := json.Marshal(edit.Ownership{Leases: []edit.Lease{lease}})
			require.NoError(t, err)
			require.NoError(t, edit.WriteAtomic(filepath.Join(coordinator, "ownership.json"), owned))
			require.NoError(t, edit.WriteAtomic(config, applied))
			if external {
				require.NoError(t, edit.SetJSON(config, edit.KV{Path: "env.API_KEY", Value: "user-edit"}))
			} else {
				require.NoError(t, edit.SetJSON(config, edit.KV{Path: "new-user-key", Value: "keep"}))
			}
			resolve := func(c string) ([]byte, error) {
				assert.Equal(t, "native-account", c)
				return []byte("legacy-test-secret"), nil
			}
			result, err := Restore(profiles, legacy, state, coordinator, []string{root}, resolve)
			if external {
				assert.ErrorContains(t, err, "externally edited")
				require.FileExists(t, receipt)
				v, _ := edit.GetJSON(config, "env.API_KEY")
				assert.Equal(t, "user-edit", v)
				return
			}
			require.NoError(t, err)
			require.Len(t, result, 1)
			v, _ := edit.GetJSON(config, "env.API_KEY")
			assert.Equal(t, "original", v)
			v, _ = edit.GetJSON(config, "new-user-key")
			assert.Equal(t, "keep", v)
			require.FileExists(t, receipt+".migrated")
			require.NoFileExists(t, receipt)
			_, err = Restore(profiles, legacy, state, coordinator, []string{root}, resolve)
			require.NoError(t, err, "repeat migration must be harmless")
		})
	}
}

func TestLegacySkillTreeDigestAndMarker(t *testing.T) {
	d := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(d, "SKILL.md"), []byte("safe skill"), 0600))
	marker := []byte("123456789012")
	require.NoError(t, os.WriteFile(filepath.Join(d, ".gateway-connector-owner"), marker, 0600))
	// Independently generated SHA256 of Rust's length-prefixed one-file tree.
	golden := "04ccd35b7e19868a39ef6c9e7615c7b0f25f27e01bdad2d58f6480a3abc5c474"
	if runtime.GOOS == "windows" {
		// Windows Rust paths use UTF-16LE bytes, not UTF-8.
		golden = "635330fada01ed0d2955fa573906236668ddc7730d10bafeabecae43d5d216a6"
	}
	hash, err := hex.DecodeString(golden)
	require.NoError(t, err)
	s := legacySkill{Path: d, Hash: hash, Marker: marker, Kind: "Directory"}
	changes, err := restoreSkill(s)
	require.NoError(t, err)
	assert.Len(t, changes, 2)
	require.NoError(t, os.WriteFile(filepath.Join(d, "SKILL.md"), []byte("user edit"), 0600))
	_, err = restoreSkill(s)
	assert.ErrorContains(t, err, "edited outside")
}
