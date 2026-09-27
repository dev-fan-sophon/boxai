package edit

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectionRepeatRestoreAndConflicts(t *testing.T) {
	d := t.TempDir()
	p := Projection{filepath.Join(d, "state"), filepath.Join(d, "coordinator")}
	path := filepath.Join(d, "claude", "settings.json")
	require.NoError(t, WriteAtomic(path, []byte(`{"model":"original","untouched":1}`)))
	l := Lease{"boxai-magpie", "claude", filepath.Dir(path)}
	apply := func(v string) error {
		return p.Run(l, []string{path}, func() error { return SetJSON(path, KV{"model", v}) })
	}
	require.NoError(t, apply("first"))
	require.NoError(t, apply("second"))
	require.NoError(t, apply("second"))
	require.NoError(t, SetJSON(path, KV{"user_added", 9007199254740993}))
	assert.ErrorContains(t, apply("third"), "edited outside")
	require.NoError(t, p.Restore())
	v, _ := GetJSON(path, "model")
	assert.Equal(t, "original", v)
	v, _ = GetJSON(path, "user_added")
	assert.Equal(t, "9007199254740993", v)
	require.NoError(t, apply("owned"))
	require.NoError(t, SetJSON(path, KV{"model", "user"}))
	assert.ErrorContains(t, p.Restore(), "externally edited")
	v, _ = GetJSON(path, "model")
	assert.Equal(t, "user", v)
}

func TestProjectionStageFailureDoesNotWrite(t *testing.T) {
	d := t.TempDir()
	p := Projection{filepath.Join(d, "state"), filepath.Join(d, "coordinator")}
	a := filepath.Join(d, "a.json")
	b := filepath.Join(d, "b.toml")
	err := p.Run(Lease{"boxai-magpie", "codex", d}, []string{a, b}, func() error {
		require.NoError(t, SetJSON(a, KV{"model", "pending"}))
		require.NoError(t, SetTOMLTop(b, KV{"model", "pending"}))
		value, _ := GetTOMLTop(b, "model")
		assert.Equal(t, "pending", value)
		_, e := os.Stat(a)
		assert.ErrorIs(t, e, os.ErrNotExist)
		return errors.New("failed second phase")
	})
	assert.ErrorContains(t, err, "failed second phase")
	_, err = os.Stat(a)
	assert.ErrorIs(t, err, os.ErrNotExist)
	_, err = os.Stat(b)
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestProjectionRecoveryAndEditedJournalTarget(t *testing.T) {
	for _, edited := range []bool{false, true} {
		t.Run(map[bool]string{false: "rollback", true: "external edit"}[edited], func(t *testing.T) {
			d := t.TempDir()
			p := Projection{filepath.Join(d, "state"), filepath.Join(d, "coordinator")}
			a := filepath.Join(d, "a.json")
			b := filepath.Join(d, "b.json")
			changes := []Change{{a, []byte("before-a"), []byte("after-a")}, {b, []byte("before-b"), []byte("after-b")}}
			raw, err := json.Marshal(changes)
			require.NoError(t, err)
			sealed, err := p.seal(raw)
			require.NoError(t, err)
			require.NoError(t, WriteAtomic(filepath.Join(p.CoordinatorDir, "transactions", "boxai-magpie-journal"), sealed))
			require.NoError(t, WriteAtomic(a, []byte("after-a")))
			require.NoError(t, WriteAtomic(b, []byte("before-b")))
			if edited {
				require.NoError(t, WriteAtomic(a, []byte("user-edit")))
			}
			err = p.Locked(func() error { return nil })
			got, readErr := os.ReadFile(a)
			require.NoError(t, readErr)
			if edited {
				assert.ErrorContains(t, err, "recovery conflict")
				assert.Equal(t, "user-edit", string(got))
			} else {
				require.NoError(t, err)
				assert.Equal(t, "before-a", string(got))
			}
		})
	}
}

func TestProjectionLegacyLeaseAndSymlinkBlocked(t *testing.T) {
	d := t.TempDir()
	p := Projection{filepath.Join(d, "state"), filepath.Join(d, "coordinator")}
	root := filepath.Join(d, ".claude")
	path := filepath.Join(root, "settings.json")
	b, err := json.Marshal(Ownership{[]Lease{{"boxai", "claude", root}}})
	require.NoError(t, err)
	require.NoError(t, WriteAtomic(filepath.Join(p.CoordinatorDir, "ownership.json"), b))
	assert.ErrorContains(t, p.Run(Lease{"boxai-magpie", "claude", root}, []string{path}, func() error { return nil }), "owned by boxai")
	require.NoError(t, os.MkdirAll(root, 0700))
	target := filepath.Join(d, "target")
	require.NoError(t, os.WriteFile(target, []byte("safe"), 0600))
	require.NoError(t, os.Symlink(target, path))
	assert.ErrorContains(t, WriteAtomic(path, []byte("unsafe")), "symlink")
	b, err = os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "safe", string(b))
}

func TestOwnedRestoreTOMLAndEnv(t *testing.T) {
	b, err := RestoreBytes("config.toml", []byte("model='old'\n"), []byte("model='new'\n"), []byte("model='new'\nunrelated=42\n"))
	require.NoError(t, err)
	assert.Contains(t, string(b), "old")
	assert.Contains(t, string(b), "unrelated = 42")
	b, err = RestoreBytes(".env", []byte("KEY=old\n"), []byte("KEY=projected\n"), []byte("KEY=projected\nUSER_KEY=keep\n# note\n"))
	require.NoError(t, err)
	assert.Contains(t, string(b), "KEY=old")
	assert.Contains(t, string(b), "USER_KEY=keep")
	assert.Contains(t, string(b), "# note")
	_, err = RestoreBytes(".env", []byte("KEY=old\n"), []byte("KEY=projected\n"), []byte("KEY=user-edit\n"))
	assert.ErrorContains(t, err, "externally edited")
}
