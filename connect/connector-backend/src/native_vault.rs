//! Native secret storage and resumable migration of legacy profile secrets.
use std::sync::{Arc, Mutex};

use gateway_connector_core::{ConnectionProfile, CredentialRef};

use crate::{ApiKey, CredentialStore, ProfileStore, VaultError};

/// Copies legacy secrets into the vault and verifies them before removing the
/// old field. A failed vault operation or profile commit leaves recovery intact.
#[derive(Debug)]
pub struct MigratingCredentialStore {
    profiles: Arc<dyn ProfileStore>,
    vault: Arc<dyn CredentialStore>,
    lock: Mutex<()>,
}

impl MigratingCredentialStore {
    pub fn new(profiles: Arc<dyn ProfileStore>, vault: Arc<dyn CredentialStore>) -> Self {
        Self {
            profiles,
            vault,
            lock: Mutex::new(()),
        }
    }

    fn clear_legacy(&self, credential: &CredentialRef) -> Result<(), VaultError> {
        if let Some(mut saved) = self
            .profiles
            .load()?
            .into_iter()
            .find(|p| p.credential == *credential)
            && !saved.credential_secret.is_empty()
        {
            saved.credential_secret.clear();
            self.profiles.save(&saved)?;
        }
        Ok(())
    }

    fn verify(&self, profile: &ConnectionProfile, key: &ApiKey) -> Result<(), VaultError> {
        let readback = self.vault.get(profile)?.ok_or_else(|| {
            VaultError::Unavailable(
                "Native credential read-back failed; retry without removing the legacy profile."
                    .into(),
            )
        })?;
        if readback.expose_secret() != key.expose_secret() {
            return Err(VaultError::Unavailable(
                "Native credential verification failed; legacy profile retained.".into(),
            ));
        }
        Ok(())
    }
}

impl CredentialStore for MigratingCredentialStore {
    fn get(&self, profile: &ConnectionProfile) -> Result<Option<ApiKey>, VaultError> {
        let _guard = self.lock.lock().map_err(|_| VaultError::Poisoned)?;
        // Never migrate from a caller's stale copy after explicit deletion.
        let saved = self
            .profiles
            .load()?
            .into_iter()
            .find(|p| p.id == profile.id);
        let native = self.vault.get(profile)?;
        let Some(saved) = saved.filter(|p| !p.credential_secret.is_empty()) else {
            return Ok(native);
        };
        let legacy = ApiKey::new(saved.credential_secret.clone())?;
        if let Some(native) = native {
            if native.expose_secret() != legacy.expose_secret() {
                return Err(VaultError::Unavailable(
                    "Native and legacy credentials differ; neither was overwritten.".into(),
                ));
            }
        } else {
            self.vault.set(profile, &legacy)?;
        }
        self.verify(profile, &legacy)?;
        self.clear_legacy(&profile.credential)?;
        Ok(Some(legacy))
    }

    fn set(&self, profile: &ConnectionProfile, key: &ApiKey) -> Result<(), VaultError> {
        let _guard = self.lock.lock().map_err(|_| VaultError::Poisoned)?;
        self.vault.set(profile, key)?;
        self.verify(profile, key)?;
        self.clear_legacy(&profile.credential)
    }

    fn delete(&self, credential: &CredentialRef) -> Result<(), VaultError> {
        let _guard = self.lock.lock().map_err(|_| VaultError::Poisoned)?;
        // If native deletion fails it remains retryable; no stale plaintext
        // may later recreate a successfully deleted native credential.
        self.clear_legacy(credential)?;
        self.vault.delete(credential)
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod native {
    use super::*;
    use std::sync::mpsc;

    #[derive(Debug)]
    enum Operation {
        Get,
        Set(ApiKey),
        Delete,
    }
    type Reply = mpsc::SyncSender<Result<Option<ApiKey>, VaultError>>;

    /// All platform operations execute on one worker, including read-back.
    /// No platform store or secret is accessed on the GPUI event thread.
    #[derive(Debug)]
    pub struct NativeCredentialStore {
        sender: mpsc::Sender<(CredentialRef, Operation, Reply)>,
    }

    impl NativeCredentialStore {
        pub fn new() -> Result<Self, VaultError> {
            let (sender, receiver) = mpsc::channel::<(CredentialRef, Operation, Reply)>();
            std::thread::Builder::new()
                .name("connect-credentials".into())
                .spawn(move || {
                    for (credential, operation, reply) in receiver {
                        let result = (|| {
                            let entry =
                                keyring::Entry::new("com.you-box.connect", credential.as_str())
                                    .map_err(native_error)?;
                            match operation {
                                Operation::Get => match entry.get_password() {
                                    Ok(value) => ApiKey::new(value).map(Some),
                                    Err(keyring::Error::NoEntry) => Ok(None),
                                    Err(error) => Err(native_error(error)),
                                },
                                Operation::Set(key) => entry
                                    .set_password(key.expose_secret())
                                    .map(|()| None)
                                    .map_err(native_error),
                                Operation::Delete => match entry.delete_credential() {
                                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(None),
                                    Err(error) => Err(native_error(error)),
                                },
                            }
                        })();
                        let _ = reply.send(result);
                    }
                })
                .map_err(|_| {
                    VaultError::Unavailable("Could not start native credential worker.".into())
                })?;
            Ok(Self { sender })
        }

        fn call(
            &self,
            credential: &CredentialRef,
            operation: Operation,
        ) -> Result<Option<ApiKey>, VaultError> {
            let (reply, receiver) = mpsc::sync_channel(1);
            self.sender
                .send((credential.clone(), operation, reply))
                .map_err(|_| VaultError::Poisoned)?;
            receiver.recv().map_err(|_| VaultError::Poisoned)?
        }
    }

    // Some keyring error variants contain the secret bytes. Never format them.
    fn native_error(_error: keyring::Error) -> VaultError {
        VaultError::Unavailable("Native credential storage is unavailable. Unlock or allow access to Keychain / Credential Manager, then retry. Legacy credentials have not been discarded.".into())
    }

    impl CredentialStore for NativeCredentialStore {
        fn get(&self, profile: &ConnectionProfile) -> Result<Option<ApiKey>, VaultError> {
            self.call(&profile.credential, Operation::Get)
        }
        fn set(&self, profile: &ConnectionProfile, key: &ApiKey) -> Result<(), VaultError> {
            self.call(&profile.credential, Operation::Set(key.clone()))
                .map(|_| ())
        }
        fn delete(&self, credential: &CredentialRef) -> Result<(), VaultError> {
            self.call(credential, Operation::Delete).map(|_| ())
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub use native::NativeCredentialStore;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{InMemoryCredentialStore, InMemoryProfileStore, StoreError};
    use gateway_connector_core::{CanonicalBaseUrl, ProfileId};
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Debug, Default)]
    struct FaultProfiles {
        inner: InMemoryProfileStore,
        fail_save: AtomicBool,
    }

    impl ProfileStore for FaultProfiles {
        fn load(&self) -> Result<Vec<ConnectionProfile>, StoreError> {
            self.inner.load()
        }
        fn create(&self, profile: &ConnectionProfile) -> Result<(), StoreError> {
            self.inner.create(profile)
        }
        fn save(&self, profile: &ConnectionProfile) -> Result<(), StoreError> {
            if self.fail_save.load(Ordering::SeqCst) {
                return Err(StoreError::Poisoned);
            }
            self.inner.save(profile)
        }
        fn delete(&self, id: ProfileId) -> Result<(), StoreError> {
            self.inner.delete(id)
        }
    }

    #[test]
    fn failed_profile_cleanup_preserves_both_copies_and_retries() {
        let profiles = Arc::new(FaultProfiles::default());
        let vault = Arc::new(InMemoryCredentialStore::default());
        let mut profile = ConnectionProfile::new(
            "Legacy",
            CanonicalBaseUrl::parse("https://you-box.com").expect("URL"),
        )
        .expect("profile");
        profile.credential_secret = "migration-recovery-value".into();
        profiles.create(&profile).expect("legacy profile");
        profiles.fail_save.store(true, Ordering::SeqCst);
        let store = MigratingCredentialStore::new(profiles.clone(), vault.clone());
        assert!(store.get(&profile).is_err());
        assert_eq!(
            profiles.load().expect("profiles")[0].credential_secret,
            "migration-recovery-value"
        );
        assert_eq!(
            vault
                .get(&profile)
                .expect("native read")
                .expect("key")
                .expose_secret(),
            "migration-recovery-value"
        );
        profiles.fail_save.store(false, Ordering::SeqCst);
        assert_eq!(
            store
                .get(&profile)
                .expect("retry")
                .expect("key")
                .expose_secret(),
            "migration-recovery-value"
        );
        assert!(
            profiles.load().expect("profiles")[0]
                .credential_secret
                .is_empty()
        );
    }

    #[derive(Debug)]
    struct FaultVault {
        inner: InMemoryCredentialStore,
        fail_write: bool,
        hide_readback: bool,
    }

    impl CredentialStore for FaultVault {
        fn get(&self, profile: &ConnectionProfile) -> Result<Option<ApiKey>, VaultError> {
            if self.hide_readback {
                Ok(None)
            } else {
                self.inner.get(profile)
            }
        }
        fn set(&self, profile: &ConnectionProfile, key: &ApiKey) -> Result<(), VaultError> {
            if self.fail_write {
                Err(VaultError::Unavailable("denied".into()))
            } else {
                self.inner.set(profile, key)
            }
        }
        fn delete(&self, credential: &CredentialRef) -> Result<(), VaultError> {
            self.inner.delete(credential)
        }
    }

    #[test]
    fn failed_write_or_readback_keeps_legacy_secret_recoverable() {
        for (fail_write, hide_readback) in [(true, false), (false, true)] {
            let profiles = Arc::new(InMemoryProfileStore::default());
            let mut profile = ConnectionProfile::new(
                "Legacy",
                CanonicalBaseUrl::parse("https://you-box.com").expect("URL"),
            )
            .expect("profile");
            profile.credential_secret = "recover-me".into();
            profiles.create(&profile).expect("legacy profile");
            let store = MigratingCredentialStore::new(
                profiles.clone(),
                Arc::new(FaultVault {
                    inner: InMemoryCredentialStore::default(),
                    fail_write,
                    hide_readback,
                }),
            );
            assert!(store.get(&profile).is_err());
            assert_eq!(
                profiles.load().expect("profiles")[0].credential_secret,
                "recover-me"
            );
        }
    }

    #[test]
    fn interrupted_migration_resumes_and_stale_profiles_cannot_resurrect_deleted_keys() {
        let profiles = Arc::new(InMemoryProfileStore::default());
        let vault = Arc::new(InMemoryCredentialStore::default());
        let mut profile = ConnectionProfile::new(
            "Legacy",
            CanonicalBaseUrl::parse("https://you-box.com").expect("URL"),
        )
        .expect("profile");
        profile.credential_secret = "legacy-secret".into();
        profiles.create(&profile).expect("legacy profile");
        vault
            .set(&profile, &ApiKey::new("legacy-secret").expect("key"))
            .expect("interrupted copy");
        let store = MigratingCredentialStore::new(profiles.clone(), vault.clone());
        assert_eq!(
            store
                .get(&profile)
                .expect("migrate")
                .expect("key")
                .expose_secret(),
            "legacy-secret"
        );
        assert!(
            profiles.load().expect("profiles")[0]
                .credential_secret
                .is_empty()
        );
        store.delete(&profile.credential).expect("delete");
        assert!(store.get(&profile).expect("stale read").is_none());
    }

    #[test]
    fn conflicting_native_value_preserves_both_copies() {
        let profiles = Arc::new(InMemoryProfileStore::default());
        let vault = Arc::new(InMemoryCredentialStore::default());
        let mut profile = ConnectionProfile::new(
            "Legacy",
            CanonicalBaseUrl::parse("https://you-box.com").expect("URL"),
        )
        .expect("profile");
        profile.credential_secret = "older-secret".into();
        profiles.create(&profile).expect("profile");
        vault
            .set(&profile, &ApiKey::new("newer-secret").expect("key"))
            .expect("native key");
        let store = MigratingCredentialStore::new(profiles.clone(), vault.clone());
        assert!(store.get(&profile).is_err());
        assert_eq!(
            profiles.load().expect("profiles")[0].credential_secret,
            "older-secret"
        );
        assert_eq!(
            vault
                .get(&profile)
                .expect("native read")
                .expect("key")
                .expose_secret(),
            "newer-secret"
        );
    }
}
