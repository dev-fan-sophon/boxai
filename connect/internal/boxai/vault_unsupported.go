//go:build (!darwin && !windows) || (darwin && !cgo)

package boxai

import "context"

// Linux intentionally fails closed until a supported Secret Service backend
// is available. macOS builds without Security.framework support do likewise.
func readNative(context.Context, string) (string, error) { return "", ErrVaultUnavailable }
func writeNative(context.Context, string, string) error  { return ErrVaultUnavailable }
func deleteNative(context.Context, string) error         { return ErrVaultUnavailable }
