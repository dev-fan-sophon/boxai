//go:build !windows

package edit

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockProjection(f *os.File) error { return unix.Flock(int(f.Fd()), unix.LOCK_EX) }
func unlockProjection(f *os.File)     { _ = unix.Flock(int(f.Fd()), unix.LOCK_UN) }

func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
