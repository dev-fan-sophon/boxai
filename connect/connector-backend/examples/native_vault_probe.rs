//! Explicit native-store acceptance. No network or installed Agent state.
//! Uses a fresh random credential identity and removes only that entry.
#[cfg(any(target_os = "macos", target_os = "windows"))]
use gateway_connector_backend::{ApiKey, CredentialStore, NativeCredentialStore};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use gateway_connector_core::{CanonicalBaseUrl, ConnectionProfile};

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn main() {
    eprintln!("Native credential acceptance requires macOS or Windows; no fallback store is used.");
    std::process::exit(2);
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let profile = ConnectionProfile::new(
        "Disposable native credential acceptance",
        CanonicalBaseUrl::parse("https://acceptance.invalid")?,
    )?;
    let store = NativeCredentialStore::new()?;
    assert!(store.get(&profile)?.is_none());
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        for value in ["disposable-first-value", "disposable-replacement-value"] {
            store.set(&profile, &ApiKey::new(value)?)?;
            assert_eq!(
                store.get(&profile)?.expect("native value").expose_secret(),
                value
            );
        }
        Ok(())
    })();
    store.delete(&profile.credential)?;
    assert!(store.get(&profile)?.is_none());
    result?;
    println!("PASS: native credential create/read/replace/delete; disposable entry removed");
    Ok(())
}
