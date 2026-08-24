//! GPUI host and views. Application state stays in the crate root.

mod account;
mod agents;
mod chrome;
mod controls;
mod dock_icon;
mod host;
mod launch;
mod mcp;
mod models;
mod overview;
mod settings;
mod shell;
mod sign_in;
mod skills;
mod vendor_icons;

pub use launch::{run, run_launch, run_with_assets};

impl<T> gpui_kit::prelude::HasPhase for crate::AsyncValue<T> {
    fn phase(&self) -> gpui_kit::prelude::Phase {
        use crate::AsyncStatus;
        use gpui_kit::prelude::Phase;

        match self.status {
            AsyncStatus::Idle => Phase::Idle,
            AsyncStatus::Loading => Phase::Loading,
            AsyncStatus::Refreshing => Phase::Refreshing,
            AsyncStatus::Ready => Phase::Ready,
            AsyncStatus::Error(_) => Phase::Error,
        }
    }

    fn reason(&self) -> Option<&str> {
        match &self.status {
            crate::AsyncStatus::Error(error) => Some(error),
            _ => None,
        }
    }

    fn is_stale(&self) -> bool {
        self.value.is_some() && matches!(self.status, crate::AsyncStatus::Error(_))
    }
}

#[cfg(test)]
mod tests {
    use gpui_kit::prelude::{HasPhase, Phase};

    use crate::{AsyncStatus, AsyncValue};

    #[test]
    fn app_async_values_keep_refresh_and_stale_failure_distinct() {
        let refreshing = AsyncValue {
            value: Some("verified"),
            status: AsyncStatus::Refreshing,
        };
        assert_eq!(refreshing.phase(), Phase::Refreshing);
        assert!(!HasPhase::is_stale(&refreshing));

        let failed = AsyncValue {
            value: Some("verified"),
            status: AsyncStatus::Error("offline".into()),
        };
        assert_eq!(failed.phase(), Phase::Error);
        assert_eq!(failed.reason(), Some("offline"));
        assert!(HasPhase::is_stale(&failed));
    }
}
