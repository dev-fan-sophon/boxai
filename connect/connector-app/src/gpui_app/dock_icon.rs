//! macOS Dock tile for unpackaged launches.
//!
//! A `cargo run` Mach-O has no `Info.plist` / `Resources/*.icns`. GPUI's
//! `WindowOptions.icon` is X11-only, so the host paints the Dock from the same
//! PNG the staged `.app` turns into `BoxAIConnect.icns`.

#[cfg(any(target_os = "macos", test))]
const DOCK_ICON_PNG: &[u8] = include_bytes!("../../packaging/icon.png");
#[cfg(any(target_os = "macos", test))]
const PNG_MAGIC: &[u8] = &[0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];

pub(crate) fn apply_runtime_dock_icon() {
    #[cfg(target_os = "macos")]
    {
        let _ = macos::apply(DOCK_ICON_PNG);
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::PNG_MAGIC;
    use cocoa::appkit::{NSApp, NSApplication, NSImage};
    use cocoa::base::nil;
    use cocoa::foundation::NSData;
    use std::ffi::c_void;

    pub(super) fn apply(png: &[u8]) -> bool {
        if !png.starts_with(PNG_MAGIC) {
            return false;
        }
        set_application_icon(png)
    }

    #[allow(unsafe_code)]
    fn set_application_icon(png: &[u8]) -> bool {
        unsafe {
            let app = NSApp();
            if app == nil {
                return false;
            }
            let data =
                NSData::dataWithBytes_length_(nil, png.as_ptr().cast::<c_void>(), png.len() as _);
            if data == nil {
                return false;
            }
            let image = NSImage::initWithData_(NSImage::alloc(nil), data);
            if image == nil {
                return false;
            }
            app.setApplicationIconImage_(image);
            true
        }
    }

    #[cfg(test)]
    mod tests {
        use super::super::DOCK_ICON_PNG;
        use super::*;

        #[test]
        fn packaged_dock_png_is_a_real_png() {
            assert!(DOCK_ICON_PNG.starts_with(PNG_MAGIC));
            assert!(DOCK_ICON_PNG.len() > 1024);
        }

        #[test]
        fn non_png_bytes_are_rejected() {
            assert!(!apply(b"not-a-png"));
        }
    }
}

#[cfg(all(test, not(target_os = "macos")))]
mod tests {
    use super::{DOCK_ICON_PNG, PNG_MAGIC};

    #[test]
    fn packaged_dock_png_is_a_real_png() {
        assert!(DOCK_ICON_PNG.starts_with(PNG_MAGIC));
        assert!(DOCK_ICON_PNG.len() > 1024);
    }
}
