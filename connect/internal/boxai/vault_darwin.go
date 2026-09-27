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
static OSStatus writeSecret(char *service, char *account, char *value) {
 SecKeychainItemRef item = NULL;
 OSStatus status = SecKeychainFindGenericPassword(NULL, strlen(service), service, strlen(account), account, NULL, NULL, &item);
 if (status == errSecItemNotFound) return SecKeychainAddGenericPassword(NULL, strlen(service), service, strlen(account), account, strlen(value), value, NULL);
 if (status != errSecSuccess) return status;
 status = SecKeychainItemModifyAttributesAndData(item, NULL, strlen(value), value); CFRelease(item); return status;
}
static OSStatus deleteSecret(char *service, char *account) {
 SecKeychainItemRef item = NULL;
 OSStatus status = SecKeychainFindGenericPassword(NULL, strlen(service), service, strlen(account), account, NULL, NULL, &item);
 if (status != errSecSuccess) return status;
 status = SecKeychainItemDelete(item); CFRelease(item); return status;
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
		return "", ErrVaultUnavailable
	}
	defer C.SecKeychainItemFreeContent(nil, data)
	return C.GoStringN((*C.char)(data), C.int(n)), nil
}
func writeNative(ctx context.Context, key, value string) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	s := C.CString(vaultService)
	k := C.CString(key)
	v := C.CString(value)
	defer C.free(unsafe.Pointer(s))
	defer C.free(unsafe.Pointer(k))
	defer C.free(unsafe.Pointer(v))
	if C.writeSecret(s, k, v) != C.errSecSuccess {
		return ErrVaultUnavailable
	}
	return nil
}
func deleteNative(ctx context.Context, key string) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	s := C.CString(vaultService)
	k := C.CString(key)
	defer C.free(unsafe.Pointer(s))
	defer C.free(unsafe.Pointer(k))
	status := C.deleteSecret(s, k)
	if status != C.errSecSuccess && status != C.errSecItemNotFound {
		return ErrVaultUnavailable
	}
	return nil
}
