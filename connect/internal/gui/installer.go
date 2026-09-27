package gui

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/update"
)

var (
	latestInstaller   = update.Latest
	downloadInstaller = update.DownloadInstaller
	openInstaller     = update.OpenInstaller
)

// Updates are explicit installer handoffs. Neither closing nor quitting the app
// installs anything, and no upstream self-replacement route is mounted.
func installerRoutes(mux *http.ServeMux) {
	var mu sync.Mutex
	var release *update.Release
	mux.HandleFunc("POST /api/installer/check", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		rel, err := latestInstaller(ctx)
		if err != nil {
			fail(w, err)
			return
		}
		mu.Lock()
		release = rel
		mu.Unlock()
		writeJSON(w, map[string]any{"version": rel.Version, "available": update.Newer(rel.Version, Version)})
	})
	mux.HandleFunc("POST /api/installer/open", func(w http.ResponseWriter, r *http.Request) {
		// Serialize explicit clicks; the frontend also disables its button.
		mu.Lock()
		defer mu.Unlock()
		if release == nil || !update.Newer(release.Version, Version) {
			http.Error(w, "check for an update first", http.StatusBadRequest)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
		defer cancel()
		path, err := downloadInstaller(ctx, release)
		if err == nil {
			err = openInstaller(path)
		}
		if err != nil {
			fail(w, err)
			return
		}
		release = nil
		w.WriteHeader(http.StatusNoContent)
	})
}
