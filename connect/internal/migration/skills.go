package migration

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"unicode/utf16"

	"github.com/yetone/magpie/internal/edit"
)

type legacySkill struct {
	Path   string `json:"path"`
	Hash   []byte `json:"applied_hash"`
	Marker []byte `json:"marker"`
	Kind   string `json:"kind"`
}

// Reproduce Rust's hash_tree, including platform path bytes and executable
// bits, before removing ANY file. Empty directories remain deliberately: a
// concurrent user-created file must never be removed by a recursive delete.
func restoreSkill(s legacySkill) ([]edit.Change, error) {
	if s.Kind != "Directory" || len(s.Hash) != 32 || len(s.Marker) != 12 {
		return nil, errors.New("unsupported legacy skill receipt; preserve its directory and encrypted receipt")
	}
	if err := edit.PlainPath(s.Path); err != nil {
		return nil, err
	}
	markerPath := filepath.Join(s.Path, ".gateway-connector-owner")
	marker, err := read(markerPath)
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(marker, s.Marker) {
		return nil, errors.New("legacy skill ownership marker changed; nothing restored")
	}
	type entry struct {
		name       []byte
		kind       byte
		executable bool
		content    []byte
	}
	var entries []entry
	var changes []edit.Change
	var total int64
	err = filepath.WalkDir(s.Path, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == s.Path || path == markerPath {
			return nil
		}
		if len(entries) >= 4096 {
			return errors.New("legacy skill exceeds safe recovery limits")
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("legacy skill contains symlink; restore blocked")
		}
		rel, err := filepath.Rel(s.Path, path)
		if err != nil {
			return err
		}
		name := []byte(rel)
		if runtime.GOOS == "windows" {
			name = nil
			for _, v := range utf16.Encode([]rune(rel)) {
				name = binary.LittleEndian.AppendUint16(name, v)
			}
		}
		e := entry{name: name, kind: 'D'}
		if !d.IsDir() {
			if !info.Mode().IsRegular() {
				return errors.New("legacy skill contains special file")
			}
			total += info.Size()
			if total > 64<<20 {
				return errors.New("legacy skill exceeds safe recovery limits")
			}
			e.kind = 'F'
			e.executable = runtime.GOOS != "windows" && info.Mode().Perm()&0111 != 0
			e.content, err = read(path)
			if err != nil {
				return err
			}
			changes = append(changes, edit.Change{Path: path, Before: e.content, After: nil})
		}
		entries = append(entries, e)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return bytes.Compare(entries[i].name, entries[j].name) < 0 })
	h := sha256.New()
	h.Write(binary.BigEndian.AppendUint64(nil, uint64(len(entries))))
	for _, e := range entries {
		flag := byte(0)
		if e.executable {
			flag = 1
		}
		h.Write([]byte{e.kind, flag})
		h.Write(binary.BigEndian.AppendUint64(nil, uint64(len(e.name))))
		h.Write(e.name)
		h.Write(binary.BigEndian.AppendUint64(nil, uint64(len(e.content))))
		h.Write(e.content)
	}
	if !bytes.Equal(h.Sum(nil), s.Hash) {
		return nil, errors.New("legacy skill was edited outside Connect; keep the directory and resolve edits before migration")
	}
	return append(changes, edit.Change{Path: markerPath, Before: marker, After: nil}), nil
}
