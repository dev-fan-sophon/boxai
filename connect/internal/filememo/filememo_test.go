package filememo

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReadDetectsSameSizeChangeWithIdenticalTimestamp(t *testing.T) {
	p := filepath.Join(t.TempDir(), "account")
	require.NoError(t, os.WriteFile(p, []byte("alice"), 0o600))
	stamp := time.Unix(1700000000, 0)
	require.NoError(t, os.Chtimes(p, stamp, stamp))
	parse := func(b []byte) (string, error) { return string(b), nil }
	value, err := Read("identity", p, parse)
	require.NoError(t, err)
	assert.Equal(t, "alice", value)
	require.NoError(t, os.WriteFile(p, []byte("other"), 0o600))
	require.NoError(t, os.Chtimes(p, stamp, stamp))
	value, err = Read("identity", p, parse)
	require.NoError(t, err)
	assert.Equal(t, "other", value)
}

func TestRead(t *testing.T) {
	p := filepath.Join(t.TempDir(), "f")
	os.WriteFile(p, []byte("a"), 0o600)
	n := 0
	parse := func(b []byte) (string, error) { n++; return string(b), nil }
	for range 3 {
		if v, err := Read("t", p, parse); err != nil || v != "a" {
			t.Fatal(v, err)
		}
	}
	if n != 1 {
		t.Fatalf("parsed %d times", n)
	}
	os.WriteFile(p, []byte("bb"), 0o600)
	os.Chtimes(p, time.Now(), time.Now().Add(time.Second))
	if v, _ := Read("t", p, parse); v != "bb" || n != 2 {
		t.Fatalf("after a change: %q, parsed %d times", v, n)
	}
	os.Remove(p)
	if _, err := Read("t", p, parse); err == nil {
		t.Fatal("a file gone is an error")
	}
}
