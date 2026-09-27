//go:build !nogui

package main

import (
	"context"
	"time"

	"github.com/yetone/magpie/internal/boxai"
	"github.com/yetone/magpie/internal/gui"
	"github.com/yetone/magpie/internal/proc"
)

const hasGUI = true

// the desktop app may have been opened from the Finder, with none of the
// PATH a terminal has
func runGUI(showMain bool, link string) error {
	proc.UserPath()
	gui.ConfigureAuth(boxai.Handler(openBoxAIBrowser), requireBoxAI)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = requireBoxAI(ctx)
	}()
	return gui.Run(version, showMain, link)
}
