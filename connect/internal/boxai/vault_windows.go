package boxai

import (
	"context"
	"encoding/binary"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var credDLL = syscall.NewLazyDLL("advapi32.dll")
var credRead = credDLL.NewProc("CredReadW")
var credFree = credDLL.NewProc("CredFree")

type credential struct {
	Flags          uint32
	Type           uint32
	TargetName     *uint16
	Comment        *uint16
	LastWritten    syscall.Filetime
	BlobSize       uint32
	Blob           *byte
	Persist        uint32
	AttributeCount uint32
	Attributes     uintptr
	TargetAlias    *uint16
	UserName       *uint16
}

// keyring's Windows target format is username.service.
func target(key string) *uint16 {
	p, _ := syscall.UTF16PtrFromString(key + "." + vaultService)
	return p
}
func readNative(ctx context.Context, key string) (string, error) {
	if e := ctx.Err(); e != nil {
		return "", e
	}
	var p *credential
	ok, _, e := credRead.Call(uintptr(unsafe.Pointer(target(key))), 1, 0, uintptr(unsafe.Pointer(&p)))
	if ok == 0 {
		if e == syscall.Errno(1168) {
			return "", errMissing
		}
		return "", errLegacyVaultUnavailable
	}
	defer credFree.Call(uintptr(unsafe.Pointer(p)))
	if p.BlobSize > 65536 || p.BlobSize%2 != 0 {
		return "", errLegacyVaultUnavailable
	}
	b := unsafe.Slice(p.Blob, int(p.BlobSize))
	units := make([]uint16, len(b)/2)
	for i := range units {
		units[i] = binary.LittleEndian.Uint16(b[i*2:])
	}
	for i := 0; i < len(units); i++ {
		if units[i] >= 0xD800 && units[i] <= 0xDBFF {
			if i+1 == len(units) || units[i+1] < 0xDC00 || units[i+1] > 0xDFFF {
				return "", errLegacyVaultUnavailable
			}
			i++
		} else if units[i] >= 0xDC00 && units[i] <= 0xDFFF {
			return "", errLegacyVaultUnavailable
		}
	}
	return string(utf16.Decode(units)), nil
}
