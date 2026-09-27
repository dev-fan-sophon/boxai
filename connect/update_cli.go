package main

import (
	"context"
	"fmt"
	"time"

	"github.com/yetone/magpie/internal/update"
)

// updateCmd verifies the official installer before handing it to the OS.
func updateCmd(args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	rel, err := update.Latest(ctx)
	if err != nil {
		return err
	}
	if !update.Newer(rel.Version, version) {
		if update.Released(version) {
			fmt.Println(green.Render("✓"), "BoxAI Connect", version, muted.Render("is the latest"))
		} else {
			fmt.Println("BoxAI Connect", version, muted.Render("was built from source; the latest release is "+rel.Version))
		}
		return nil
	}
	fmt.Println("BoxAI Connect", bold.Render(rel.Version), "is out", muted.Render("(you have "+version+") · "+rel.URL))
	if len(args) > 1 && args[1] == "check" {
		return nil
	}
	if !update.Released(version) {
		return fmt.Errorf("this BoxAI Connect was built from source; rebuild it or get the release from %s", update.Site)
	}
	fmt.Println(muted.Render("Downloading and verifying the BoxAI installer…"))
	installer, err := update.DownloadInstaller(ctx, rel)
	if err != nil {
		return err
	}
	fmt.Println("Verified installer downloaded. Follow the installer to finish the update.")
	return update.OpenInstaller(installer)
}
