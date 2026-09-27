//go:build nogui

package main

import "errors"

const hasGUI = false

func runGUI(bool, string) error {
	return errors.New("this build has no desktop UI; run `boxai-connect login` then `boxai-connect serve`")
}
