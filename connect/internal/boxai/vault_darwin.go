//go:build darwin && cgo

package boxai

/*
#cgo LDFLAGS: -framework Security -framework CoreFoundation
#include <Security/Security.h>
#include <stdlib.h>
#include <string.h>
static OSStatus readSecret(char *service, char *account, UInt32 *n, void **data) {
 return SecKeychainFindGenericPassword(NULL, strlen(service), service, strlen(account), account, n, data, NULL);
}
*/
import "C"
import (
	"context"
	"unsafe"
)

func readNative(ctx context.Context, key string) (string, error) {
	if e := ctx.Err(); e != nil {
		return "", e
	}
	s := C.CString(vaultService)
	k := C.CString(key)
	defer C.free(unsafe.Pointer(s))
	defer C.free(unsafe.Pointer(k))
	var n C.UInt32
	var data unsafe.Pointer
	status := C.readSecret(s, k, &n, &data)
	if status == C.errSecItemNotFound {
		return "", errMissing
	}
	if status != C.errSecSuccess {
		return "", errLegacyVaultUnavailable
	}
	defer C.SecKeychainItemFreeContent(nil, data)
	return C.GoStringN((*C.char)(data), C.int(n)), nil
}
