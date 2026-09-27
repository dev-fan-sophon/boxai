package gui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yetone/magpie/internal/update"
)

func TestInstallerRequiresExplicitVerifiedHandoff(t *testing.T) {
	oldLatest, oldDownload, oldOpen, oldVersion := latestInstaller, downloadInstaller, openInstaller, Version
	t.Cleanup(func() {
		latestInstaller, downloadInstaller, openInstaller, Version = oldLatest, oldDownload, oldOpen, oldVersion
	})
	Version = "2.0.0"
	latestInstaller = func(context.Context) (*update.Release, error) { return &update.Release{Version: "2.0.1"}, nil }
	var downloads, opens int
	var downloadErr error
	downloadInstaller = func(_ context.Context, release *update.Release) (string, error) {
		assert.Equal(t, "2.0.1", release.Version)
		downloads++
		return "/verified/installer", downloadErr
	}
	openInstaller = func(path string) error { assert.Equal(t, "/verified/installer", path); opens++; return nil }
	mux := http.NewServeMux()
	installerRoutes(mux)
	request := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", path, nil))
		return w
	}
	assert.Equal(t, http.StatusBadRequest, request("/api/installer/open").Code)
	assert.Zero(t, downloads)
	w := request("/api/installer/check")
	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"version":"2.0.1","available":true}`, w.Body.String())
	assert.Zero(t, downloads, "checking must never download or launch automatically")
	assert.Zero(t, opens)
	downloadErr = errors.New("signature invalid")
	assert.Equal(t, http.StatusBadRequest, request("/api/installer/open").Code)
	assert.Zero(t, opens, "an unverified download must never reach the installer")
	downloadErr = nil
	assert.Equal(t, http.StatusNoContent, request("/api/installer/open").Code)
	assert.Equal(t, 1, opens)
	assert.Equal(t, http.StatusBadRequest, request("/api/installer/open").Code, "a completed handoff cannot be replayed")
	assert.Equal(t, 2, downloads)
	assert.Equal(t, 1, opens)
}
