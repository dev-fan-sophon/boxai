//go:build (!darwin && !windows) || (darwin && !cgo)

package boxai

import "context"

// Only old encrypted projection migration needs a native credential backend.
// New sign-ins use auth.json on every platform.
func readNative(context.Context, string) (string, error) { return "", errLegacyVaultUnavailable }
