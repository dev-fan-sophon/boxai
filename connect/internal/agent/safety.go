package agent

import (
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/gateway"
)

var safety struct {
	sync.Mutex
	projection    *edit.Projection
	authenticated bool
}

var safetyConfigured atomic.Bool

// InitializeSafety is read-only. Call before exposing mutation handlers, with
// the old neutral ProjectionCoordinator data directory, never a branded one.
func InitializeSafety(stateDir, coordinatorDir string) error {
	if !filepath.IsAbs(stateDir) || !filepath.IsAbs(coordinatorDir) {
		return errors.New("absolute state and neutral coordinator directories required")
	}
	if err := edit.PlainPath(stateDir); err != nil {
		return err
	}
	if err := edit.PlainPath(coordinatorDir); err != nil {
		return err
	}
	safety.Lock()
	defer safety.Unlock()
	safety.projection = &edit.Projection{StateDir: stateDir, CoordinatorDir: coordinatorDir}
	safety.authenticated = false
	safetyConfigured.Store(true)
	return nil
}
func SetAuthenticated(v bool) { safety.Lock(); defer safety.Unlock(); safety.authenticated = v }
func Authenticated() bool {
	safety.Lock()
	defer safety.Unlock()
	return safety.authenticated && safety.projection != nil
}
func SafetyEnabled() bool { return safetyConfigured.Load() }

// Project is shared with the official library so model and MCP writes use one
// receipt and lease. The callback must use edit APIs, not direct filesystem IO.
func Project(a *Agent, paths []string, fn func() error) error {
	safety.Lock()
	defer safety.Unlock()
	if safety.projection == nil || !safety.authenticated {
		return errors.New("sign in to BoxAI before changing agent configuration")
	}
	if gateway.Credential() == "" {
		return errors.New("local gateway credential unavailable; sign in again")
	}
	id := a.ID
	if id == "grok" {
		id = "grokbuild"
	}
	policies.RLock()
	p, ok := policies.agents[id]
	policies.RUnlock()
	if !ok || !p.Enabled {
		return errors.New("this agent is not enabled by BoxAI provisioning")
	}
	root := a.Dir
	if root == "" {
		root = filepath.Dir(a.Path)
	}
	return safety.projection.Run(edit.Lease{Platform: "boxai-magpie", Agent: id, Root: root}, paths, fn)
}
func RestoreAll() error {
	safety.Lock()
	defer safety.Unlock()
	if safety.projection == nil {
		return errors.New("configuration safety not initialized")
	}
	// Holding this lock prevents an apply racing with logout/restore.
	safety.authenticated = false
	return safety.projection.Restore()
}
func (a *Agent) projectionPaths() []string {
	paths := []string{a.Path, stashPath(), appliedPath()}
	switch a.ID {
	case "codex":
		paths = append(paths, filepath.Join(a.Dir, "magpie-models.json"))
	case "gemini":
		paths = append(paths, filepath.Join(a.Dir, ".env"))
	}
	return paths
}
