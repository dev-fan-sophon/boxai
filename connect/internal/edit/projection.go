package edit

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Lease deliberately retains the neutral Rust connector's on-disk identity.
type Lease struct {
	Platform string `json:"platform_id"`
	Agent    string `json:"agent"`
	Root     string `json:"root"`
}
type Ownership struct {
	Leases []Lease `json:"leases"`
}
type FileProjection struct {
	Path     string `json:"path"`
	Original []byte `json:"original"`
	Applied  []byte `json:"applied"`
}
type projectionReceipt struct {
	Version int              `json:"version"`
	Files   []FileProjection `json:"files"`
	Leases  []Lease          `json:"leases"`
}
type Change struct {
	Path          string
	Before, After []byte
}

// Projection serializes with old clients using the same OS lock. It never
// writes anything when constructed. Run stages edits before a durable commit.
type Projection struct{ StateDir, CoordinatorDir string }

var projectionMu sync.Mutex
var stage struct {
	sync.Mutex
	files map[string][]byte
	err   error
}

func stagedRead(path string) ([]byte, bool) {
	stage.Lock()
	defer stage.Unlock()
	b, ok := stage.files[filepath.Clean(path)]
	return bytes.Clone(b), ok
}
func stagedWrite(path string, b []byte) (bool, error) {
	stage.Lock()
	defer stage.Unlock()
	if stage.files == nil {
		return false, nil
	}
	path = filepath.Clean(path)
	if _, ok := stage.files[path]; !ok {
		stage.err = fmt.Errorf("unplanned config write: %s", path)
		return true, stage.err
	}
	stage.files[path] = bytes.Clone(b)
	return true, nil
}

// Remove participates in staging, unlike os.Remove.
func Remove(path string) error {
	if handled, err := stagedWrite(path, nil); handled {
		return err
	}
	return os.Remove(path)
}

// PlainPath rejects symlinks/reparse paths before reading or replacing files.
func PlainPath(path string) error {
	p, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	for {
		st, err := os.Lstat(p)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil && st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing symlink: %s", p)
		}
		next := filepath.Dir(p)
		if next == p {
			return nil
		}
		p = next
	}
}

func diskRead(path string) ([]byte, error) {
	if err := PlainPath(path); err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return b, err
}

func (p *Projection) Locked(fn func() error) error {
	projectionMu.Lock()
	defer projectionMu.Unlock()
	lockPath := filepath.Join(p.CoordinatorDir, "locks", "connector.lock")
	if err := PlainPath(lockPath); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(lockPath), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := lockProjection(f); err != nil {
		return err
	}
	defer unlockProjection(f)
	if err := p.recover(); err != nil {
		return err
	}
	// Never step across an interrupted legacy transaction.
	entries, err := os.ReadDir(filepath.Join(p.CoordinatorDir, "transactions"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if len(entries) != 0 {
		return errors.New("legacy transaction requires recovery in the previous Connect client; keep its vault credential and coordinator directory")
	}
	return fn()
}

func (p *Projection) receiptPath() string { return filepath.Join(p.StateDir, "projections-v1.json") }
func (p *Projection) load() (projectionReceipt, Ownership, error) {
	r := projectionReceipt{Version: 1}
	o := Ownership{}
	for path, dest := range map[string]any{p.receiptPath(): &r, filepath.Join(p.CoordinatorDir, "ownership.json"): &o} {
		b, err := diskRead(path)
		if err != nil {
			return r, o, err
		}
		if b != nil {
			if path == p.receiptPath() {
				b, err = p.open(b)
				if err != nil {
					return r, o, err
				}
			}
			if err := json.Unmarshal(b, dest); err != nil {
				return r, o, fmt.Errorf("invalid ownership record %s", path)
			}
		}
	}
	if r.Version != 1 {
		return r, o, errors.New("unsupported projection receipt; preserve state and restore with the matching Connect version")
	}
	return r, o, nil
}

func leaseKey(l Lease) string {
	root := l.Root
	if l.Agent == "claude" {
		if filepath.Base(root) == ".claude" {
			root = filepath.Join(filepath.Dir(root), ".claude.json")
		} else {
			root = filepath.Join(root, ".claude.json")
		}
	}
	return strings.ToLower(l.Agent + ":" + strings.ReplaceAll(filepath.Clean(root), "\\", "/"))
}
func hasLease(ls []Lease, l Lease) bool {
	for _, x := range ls {
		if x.Platform == l.Platform && leaseKey(x) == leaseKey(l) {
			return true
		}
	}
	return false
}

func (p *Projection) Run(lease Lease, paths []string, fn func() error) error {
	return p.Locked(func() error {
		r, o, err := p.load()
		if err != nil {
			return err
		}
		for _, l := range o.Leases {
			if leaseKey(l) == leaseKey(lease) && !hasLease(r.Leases, l) {
				return fmt.Errorf("%s config is owned by %s; restore it before applying", lease.Agent, l.Platform)
			}
		}
		for _, l := range r.Leases {
			if !hasLease(o.Leases, l) {
				return errors.New("projection lease lost; refusing to overwrite configs")
			}
		}
		before := map[string][]byte{}
		for _, path := range paths {
			path = filepath.Clean(path)
			b, e := diskRead(path)
			if e != nil {
				return e
			}
			before[path] = b
		}
		for _, f := range r.Files {
			if b, ok := before[f.Path]; ok && !bytes.Equal(b, f.Applied) {
				return fmt.Errorf("config edited outside Connect: %s; restore or resolve edits first", f.Path)
			}
		}
		stage.Lock()
		stage.files = map[string][]byte{}
		stage.err = nil
		for k, v := range before {
			stage.files[k] = bytes.Clone(v)
		}
		stage.Unlock()
		defer func() { stage.Lock(); stage.files = nil; stage.err = nil; stage.Unlock() }()
		err = fn()
		stage.Lock()
		after := stage.files
		err = errors.Join(err, stage.err)
		stage.files = nil
		stage.Unlock()
		if err != nil {
			return err
		}
		var changes []Change
		for path, b := range before {
			a := after[path]
			if bytes.Equal(a, b) {
				continue
			}
			changes = append(changes, Change{path, b, a})
			found := false
			for i := range r.Files {
				if r.Files[i].Path == path {
					r.Files[i].Applied = a
					found = true
					break
				}
			}
			if !found {
				r.Files = append(r.Files, FileProjection{path, b, a})
			}
		}
		if len(changes) == 0 {
			return nil
		}
		if !hasLease(r.Leases, lease) {
			r.Leases = append(r.Leases, lease)
		}
		if !hasLease(o.Leases, lease) {
			o.Leases = append(o.Leases, lease)
		}
		return p.save(changes, r, o)
	})
}

func (p *Projection) save(changes []Change, r projectionReceipt, o Ownership) error {
	for path, v := range map[string]any{p.receiptPath(): r, filepath.Join(p.CoordinatorDir, "ownership.json"): o} {
		before, err := diskRead(path)
		if err != nil {
			return err
		}
		after, err := json.Marshal(v)
		if err != nil {
			return err
		}
		if path == p.receiptPath() {
			after, err = p.seal(after)
			if err != nil {
				return err
			}
		}
		changes = append(changes, Change{path, before, after})
	}
	return p.Commit(changes)
}

// Restore only reverts values still equal to the applied value. JSON objects
// merge recursively so unrelated user edits survive. Other formats fail closed
// on any external edit rather than replacing a user's whole file.
func (p *Projection) Restore() error {
	return p.Locked(func() error {
		r, o, err := p.load()
		if err != nil {
			return err
		}
		var changes []Change
		for _, l := range r.Leases {
			if !hasLease(o.Leases, l) {
				return errors.New("cannot restore: ownership lease changed")
			}
		}
		for _, f := range r.Files {
			b, e := diskRead(f.Path)
			if e != nil {
				return e
			}
			a, e := RestoreBytes(f.Path, f.Original, f.Applied, b)
			if e != nil {
				return e
			}
			changes = append(changes, Change{f.Path, b, a})
		}
		kept := []Lease{}
		for _, l := range o.Leases {
			if !hasLease(r.Leases, l) {
				kept = append(kept, l)
			}
		}
		o.Leases = kept
		return p.save(changes, projectionReceipt{Version: 1}, o)
	})
}

// Commit requires Locked. Its write-ahead journal includes ownership and
// receipts: recovery rolls the entire uncommitted operation back, not forward.
func (p *Projection) Commit(changes []Change) error {
	sort.SliceStable(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	for i, c := range changes {
		if !filepath.IsAbs(c.Path) || (i > 0 && changes[i-1].Path == c.Path) {
			return errors.New("invalid or duplicate transaction target")
		}
		b, e := diskRead(c.Path)
		if e != nil {
			return e
		}
		if !bytes.Equal(b, c.Before) {
			return fmt.Errorf("concurrent edit: %s", c.Path)
		}
	}
	b, err := json.Marshal(changes)
	if err != nil {
		return err
	}
	b, err = p.seal(b)
	if err != nil {
		return err
	}
	journal := filepath.Join(p.CoordinatorDir, "transactions", "boxai-magpie-journal")
	if err = writeAtomic(journal, b); err != nil {
		return err
	}
	for _, c := range changes {
		b, e := diskRead(c.Path)
		if e == nil && !bytes.Equal(b, c.Before) {
			e = fmt.Errorf("concurrent edit: %s", c.Path)
		}
		if e == nil {
			e = writeProjection(c.Path, c.After)
		}
		if e != nil {
			return errors.Join(e, p.recover())
		}
	}
	if err := os.Remove(journal); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(journal))
}
func writeProjection(path string, b []byte) error {
	if b != nil {
		return writeAtomic(path, b)
	}
	if err := PlainPath(path); err != nil {
		return err
	}
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
func (p *Projection) recover() error {
	path := filepath.Join(p.CoordinatorDir, "transactions", "boxai-magpie-journal")
	b, err := diskRead(path)
	if err != nil || b == nil {
		return err
	}
	b, err = p.open(b)
	if err != nil {
		return err
	}
	var changes []Change
	if json.Unmarshal(b, &changes) != nil {
		return errors.New("invalid recovery journal; preserve it for manual recovery")
	}
	for i := len(changes) - 1; i >= 0; i-- {
		c := changes[i]
		now, e := diskRead(c.Path)
		if e != nil {
			return e
		}
		if bytes.Equal(now, c.Before) {
			continue
		}
		if !bytes.Equal(now, c.After) {
			return fmt.Errorf("recovery conflict at %s; preserve journal and resolve external edits", c.Path)
		}
		if e = writeProjection(c.Path, c.Before); e != nil {
			return e
		}
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
