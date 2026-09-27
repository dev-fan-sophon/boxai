//go:build !windows

package boxai

import (
	"os"

	"golang.org/x/sys/unix"
)

func lockAuthFile(f *os.File) error         { return unix.Flock(int(f.Fd()), unix.LOCK_EX) }
func unlockAuthFile(f *os.File)             { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN) }
func protectAuthFile(f *os.File) error      { return f.Chmod(0600) }
func replaceAuthFile(from, to string) error { return os.Rename(from, to) }
func syncAuthDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
