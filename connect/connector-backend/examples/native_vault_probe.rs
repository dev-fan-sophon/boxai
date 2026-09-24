//! Explicit native-store acceptance. No network or installed Agent state.
//! Uses a fresh random credential identity and removes only that entry.
use gateway_connector_backend::{ApiKey, CredentialStore, NativeCredentialStore};
use gateway_connector_core::{CanonicalBaseUrl, ConnectionProfile};

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
