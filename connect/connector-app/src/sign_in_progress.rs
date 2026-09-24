//! What the sign-in is waiting for, while it waits.
//!
//! Browser sign-in blocks on a loopback callback the browser has to reach. When
//! that path is broken (a global proxy that does not exempt `127.0.0.1`,
//! security software that blocks a program from listening, a browser policy
//! against `http://`), nothing arrives and the only thing the person sees is a
//! spinner that eventually says it timed out. By then they have no idea which
//! of their own tools ate it.
//!
//! So the authorization URL is published the moment it exists, together with
//! whether the browser could be opened at all. The window can then show the
//! link to copy into another browser, which reaches the same callback port, and
//! can name the failure precisely when the wait runs out.

use std::sync::{
    Mutex,
    atomic::{AtomicU8, Ordering},
};

use gateway_connector_backend::{Browser, PkceError, SystemBrowser};
use url::Url;

/// The authorization URL and what happened when we tried to open it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInInvitation {
    pub authorization_url: String,
    /// False when the system had no browser to open, which is a different
    /// problem from a browser that opened and never came back.
    pub browser_opened: bool,
}

/// A slot the sign-in writes and the window reads. It is a slot rather than a
/// channel because the window may start watching after the URL was published,
/// and a value that arrived early must not be lost.
#[derive(Debug, Default)]
pub struct SignInProgress {
    invitation: Mutex<Option<SignInInvitation>>,
    // 0 waiting, 1 cancellation accepted, 2 durable commit started.
    phase: AtomicU8,
}

impl SignInProgress {
    pub fn publish(&self, invitation: SignInInvitation) {
        if let Ok(mut slot) = self.invitation.lock() {
            *slot = Some(invitation);
        }
    }

    pub fn read(&self) -> Option<SignInInvitation> {
        self.invitation.lock().ok().and_then(|slot| slot.clone())
    }

    /// Called when a sign-in starts, so a previous attempt's link cannot be
    /// shown next to a fresh wait.
    pub fn clear(&self) {
        self.phase.store(0, Ordering::Release);
        if let Ok(mut slot) = self.invitation.lock() {
            *slot = None;
        }
    }

    pub fn cancel(&self) -> bool {
        self.phase
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
            || self.phase.load(Ordering::Acquire) == 1
    }
}

/// Opens the browser exactly as before and publishes what it was asked to open.
#[derive(Debug)]
pub struct AnnouncingBrowser<B: Browser = SystemBrowser> {
    inner: B,
    progress: std::sync::Arc<SignInProgress>,
}

impl<B: Browser> AnnouncingBrowser<B> {
    pub fn new(inner: B, progress: std::sync::Arc<SignInProgress>) -> Self {
        Self { inner, progress }
    }
}

impl<B: Browser> Browser for AnnouncingBrowser<B> {
    fn open(&self, url: &Url) -> Result<(), PkceError> {
        let result = self.inner.open(url);
        self.progress.publish(SignInInvitation {
            authorization_url: url.to_string(),
            browser_opened: result.is_ok(),
        });
        // The UI has the exact PKCE link. Keep the same callback listener
        // alive for manual opening even when the OS launch failed.
        Ok(())
    }

    fn cancelled(&self) -> bool {
        self.progress.phase.load(Ordering::Acquire) == 1
    }

    fn begin_credential_commit(&self) -> bool {
        self.progress
            .phase
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Debug)]
    struct RefusingBrowser;

    impl Browser for RefusingBrowser {
        fn open(&self, _url: &Url) -> Result<(), PkceError> {
            Err(PkceError::Browser)
        }
    }

    #[derive(Debug)]
    struct AcceptingBrowser;

    impl Browser for AcceptingBrowser {
        fn open(&self, _url: &Url) -> Result<(), PkceError> {
            Ok(())
        }
    }

    #[test]
    fn a_browser_that_cannot_open_still_leaves_the_link_to_copy() {
        let progress = Arc::new(SignInProgress::default());
        let browser = AnnouncingBrowser::new(RefusingBrowser, Arc::clone(&progress));
        let url =
            Url::parse("https://you-box.com/api/v1/connector/authorize?state=abc").expect("url");

        assert!(browser.open(&url).is_ok());
        assert_eq!(
            progress.read(),
            Some(SignInInvitation {
                authorization_url: url.to_string(),
                browser_opened: false,
            }),
        );
    }

    #[test]
    fn cancellation_and_commit_are_mutually_exclusive() {
        let progress = Arc::new(SignInProgress::default());
        let browser = AnnouncingBrowser::new(AcceptingBrowser, Arc::clone(&progress));
        assert!(progress.cancel());
        assert!(!browser.begin_credential_commit());
        progress.clear();
        assert!(browser.begin_credential_commit());
        assert!(
            !progress.cancel(),
            "a completed authorization cannot be reported canceled"
        );
        assert!(!browser.cancelled());
    }

    #[test]
    fn each_attempt_starts_without_the_previous_link() {
        let progress = Arc::new(SignInProgress::default());
        let browser = AnnouncingBrowser::new(AcceptingBrowser, Arc::clone(&progress));
        let url = Url::parse("http://127.0.0.1:1/desktop/authorize").expect("url");

        browser.open(&url).expect("open");
        assert!(progress.read().is_some_and(|held| held.browser_opened));
        progress.cancel();
        assert!(browser.cancelled());
        progress.clear();
        assert!(!browser.cancelled());
        assert_eq!(progress.read(), None);
    }
}
