//! Putting the Windows download where it can keep working.
//!
//! The Windows release is one executable. That is what a person downloads, and
//! it runs perfectly well from the download folder — until the folder is
//! cleared, the file is opened straight out of an archive preview that Windows
//! deletes behind them, or a second copy of a newer version starts competing
//! with it. None of that is visible while it is happening; the symptom arrives
//! later as a Kit that has forgotten its account.
//!
//! So the program installs itself: one directory it owns, a Start menu entry,
//! an uninstall record, and a replace that either finishes or leaves the
//! previous version exactly as it was. Everything here is about that one move.
//! Signed updates then replace the same file in the same place.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use thiserror::Error;

/// Directory name under `%LOCALAPPDATA%\Programs`. It is per-user on purpose:
/// no elevation prompt, and an unsigned build never asks for administrator.
pub const INSTALL_DIRECTORY_NAME: &str = "BoxAI Connect";

/// Registry key and shortcut name. Both are stable across versions so an
/// upgrade rewrites its own record instead of leaving a second one behind.
pub const UNINSTALL_KEY_NAME: &str = "com.you-box.connect";
pub const SHORTCUT_NAME: &str = "BoxAI Connect";

/// The name the installed program always has, whichever route installed it.
/// The setup program writes this name, so an install started from a copy that
/// still carries a download name must land on the same path rather than beside
/// it: two executables in one directory means an update can replace one and a
/// shortcut can keep launching the other.
pub const EXECUTABLE_NAME: &str = "boxai-connect.exe";

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("this platform installs from its disk image instead")]
    Unsupported,
    #[error("could not locate the per-user program directory")]
    MissingProgramDirectory,
    #[error("could not read the running program: {0}")]
    UnreadableSource(String),
    #[error("the running program is already the installed copy")]
    AlreadyInstalled,
    #[error("only the installed copy can uninstall BoxAI Connect")]
    NotInstalled,
    #[error(
        "another copy of BoxAI Connect is running from the install directory; close it and try again"
    )]
    InstalledCopyRunning,
    #[error("could not write the install directory: {0}")]
    WriteFailed(String),
    #[error("could not register the Start menu entry: {0}")]
    ShellIntegration(String),
    #[error("could not start the installed program: {0}")]
    LaunchFailed(String),
}

/// Where an install of this product belongs, derived from the environment
/// rather than guessed, so the running program and the updater agree.
///
/// The setup program lets a person choose the directory, and it records the
/// choice where Windows records every install. Reading that back is what keeps
/// a chosen directory from being treated as somebody else's folder: without
/// it, a copy installed to `D:\Tools` would be told it is not installed, and
/// an update would go to the default directory instead of over the install.
pub fn install_root() -> Option<PathBuf> {
    choose_install_root(recorded_install_root(), default_install_root())
}

fn default_install_root() -> Option<PathBuf> {
    let base = env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty())?;
    Some(
        PathBuf::from(base)
            .join("Programs")
            .join(INSTALL_DIRECTORY_NAME),
    )
}

/// A recorded directory wins only while it exists. A record left behind by an
/// install someone deleted by hand must not send the next update into a
/// directory that is no longer there.
fn choose_install_root(recorded: Option<PathBuf>, default: Option<PathBuf>) -> Option<PathBuf> {
    match recorded {
        Some(recorded) if recorded.is_dir() => Some(recorded),
        _ => default,
    }
}

#[cfg(windows)]
fn recorded_install_root() -> Option<PathBuf> {
    let key = windows_registry::CURRENT_USER
        .open(format!(
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{UNINSTALL_KEY_NAME}"
        ))
        .ok()?;
    let value = key.get_string("InstallLocation").ok()?;
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

#[cfg(not(windows))]
fn recorded_install_root() -> Option<PathBuf> {
    None
}

/// True when `directory` is the directory this product installs into.
///
/// Comparison is by canonical path where both sides exist, because
/// `%LOCALAPPDATA%` is routinely reached through a junction on Windows and a
/// textual comparison would then call a real install unmanaged.
pub fn is_install_directory(directory: &Path) -> bool {
    let Some(root) = install_root() else {
        return false;
    };
    same_directory(directory, &root)
}

fn same_directory(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

/// What an install would do, decided before anything is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPlan {
    /// The running program, which is also the payload being installed.
    pub source: PathBuf,
    pub directory: PathBuf,
    pub executable: PathBuf,
    /// True when an earlier version already occupies the target path.
    pub replaces_existing: bool,
}

/// Why this copy is not an installation, or `None` when it is one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotInstalledReason {
    /// Expanded into the temporary directory, usually by opening the program
    /// inside an archive preview. This copy is deleted without warning.
    TemporaryCopy,
    /// A real, persistent location that this product does not manage —
    /// typically the download folder.
    UnmanagedLocation,
}

/// Classifies the running copy. `temporary_root` is passed in so the decision
/// is testable and so a caller can supply the platform's own temp directory.
pub fn classify(executable: &Path, temporary_root: &Path) -> Option<NotInstalledReason> {
    if !cfg!(windows) {
        return None;
    }
    let directory = executable.parent()?;
    if is_install_directory(directory) {
        return None;
    }
    if within(executable, temporary_root) {
        return Some(NotInstalledReason::TemporaryCopy);
    }
    Some(NotInstalledReason::UnmanagedLocation)
}

fn within(executable: &Path, root: &Path) -> bool {
    let (Ok(executable), Ok(root)) = (executable.canonicalize(), root.canonicalize()) else {
        return false;
    };
    executable.starts_with(&root) && executable != root
}

pub fn plan(source: &Path) -> Result<InstallPlan, InstallError> {
    if !cfg!(windows) {
        return Err(InstallError::Unsupported);
    }
    let directory = install_root().ok_or(InstallError::MissingProgramDirectory)?;
    plan_in(&directory, source)
}

/// The naming and already-installed rules, separated from where the install
/// directory comes from so they can be tested off Windows.
fn plan_in(directory: &Path, source: &Path) -> Result<InstallPlan, InstallError> {
    if source.file_name().is_none() {
        return Err(InstallError::UnreadableSource(
            "the program has no file name".to_owned(),
        ));
    }
    let executable = directory.join(EXECUTABLE_NAME);
    if same_directory(source.parent().unwrap_or(source), directory) {
        return Err(InstallError::AlreadyInstalled);
    }
    Ok(InstallPlan {
        replaces_existing: executable.exists(),
        source: source.to_path_buf(),
        directory: directory.to_path_buf(),
        executable,
    })
}

/// Everything an install touches outside its own directory. It is a trait so
/// the copy-and-replace half can be tested on any platform, and so a failure
/// to write a shortcut is reported rather than silently skipped.
pub trait ShellIntegration {
    fn register(&self, plan: &InstallPlan, desktop_shortcut: bool) -> Result<(), String>;
    fn unregister(&self, directory: &Path) -> Result<(), String>;
}

/// Copies the running program into the install directory, replacing any
/// earlier version in one step.
///
/// The replace is a rename of the existing file followed by a rename of the
/// new one: Windows lets a running executable be renamed but not overwritten,
/// so an upgrade started from the download folder succeeds even while the
/// installed copy is running, and a failure anywhere puts the old file back.
pub fn install(
    plan: &InstallPlan,
    shell: &dyn ShellIntegration,
    desktop_shortcut: bool,
) -> Result<PathBuf, InstallError> {
    fs::create_dir_all(&plan.directory)
        .map_err(|error| InstallError::WriteFailed(error.to_string()))?;

    let staged = plan.directory.join(format!(
        "{}.incoming",
        plan.executable
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("program")
    ));
    let _ = fs::remove_file(&staged);
    copy_file(&plan.source, &staged)
        .map_err(|error| InstallError::WriteFailed(error.to_string()))?;

    let backup = plan.directory.join(format!(
        "{}.previous",
        plan.executable
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("program")
    ));
    let _ = fs::remove_file(&backup);
    let replaced = if plan.executable.exists() {
        match fs::rename(&plan.executable, &backup) {
            Ok(()) => true,
            Err(error) if is_busy(&error) => {
                let _ = fs::remove_file(&staged);
                return Err(InstallError::InstalledCopyRunning);
            }
            Err(error) => {
                let _ = fs::remove_file(&staged);
                return Err(InstallError::WriteFailed(error.to_string()));
            }
        }
    } else {
        false
    };

    if let Err(error) = fs::rename(&staged, &plan.executable) {
        let _ = fs::remove_file(&staged);
        if replaced {
            let _ = fs::rename(&backup, &plan.executable);
        }
        return Err(InstallError::WriteFailed(error.to_string()));
    }
    // The previous executable can still be mapped by a process that is on its
    // way out. It is out of the way and named for what it is, so a deletion
    // that has to wait for the next install is not a failed install.
    let _ = fs::remove_file(&backup);

    shell
        .register(plan, desktop_shortcut)
        .map_err(InstallError::ShellIntegration)?;
    Ok(plan.executable.clone())
}

fn copy_file(source: &Path, dest: &Path) -> io::Result<()> {
    fs::copy(source, dest)?;
    Ok(())
}

/// Removes what [`install`] registered and the installed program itself.
/// The directory is left when it still holds anything else, because a user
/// may have put files there and an uninstall is not a licence to clear a path.
pub fn uninstall(directory: &Path, shell: &dyn ShellIntegration) -> Result<(), InstallError> {
    let current =
        env::current_exe().map_err(|error| InstallError::UnreadableSource(error.to_string()))?;
    if !same_directory(current.parent().unwrap_or(&current), directory) {
        return Err(InstallError::NotInstalled);
    }
    shell
        .unregister(directory)
        .map_err(InstallError::ShellIntegration)?;
    Ok(())
}

pub fn system_shell() -> Box<dyn ShellIntegration> {
    #[cfg(windows)]
    {
        Box::new(windows_shell::WindowsShell)
    }
    #[cfg(not(windows))]
    {
        Box::new(UnsupportedShell)
    }
}

#[cfg(not(windows))]
struct UnsupportedShell;

#[cfg(not(windows))]
impl ShellIntegration for UnsupportedShell {
    fn register(&self, _plan: &InstallPlan, _desktop_shortcut: bool) -> Result<(), String> {
        Err("this platform has no Start menu".to_owned())
    }

    fn unregister(&self, _directory: &Path) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(windows)]
mod windows_shell {
    //! Start menu entry, optional desktop shortcut, and the Programs and
    //! Features record. All three are per-user (`HKCU`, the user's own Start
    //! menu), so installing never asks for administrator rights.

    use super::{InstallPlan, SHORTCUT_NAME, ShellIntegration, UNINSTALL_KEY_NAME};
    use std::os::windows::process::CommandExt;
    use std::{
        path::Path,
        process::{Command, Stdio},
    };

    use windows_registry::CURRENT_USER;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    pub(super) struct WindowsShell;

    /// A `.lnk` is a COM-serialized object, so the shell has to write it. This
    /// crate denies unsafe code and a Start menu entry is not a good reason to
    /// make an exception, so the shell is asked through the scripting host that
    /// is already part of Windows. The scripting host resolves Known Folders
    /// rather than rebuilding them from environment variables, so OneDrive and
    /// enterprise folder redirection still receive their shortcuts. Values
    /// travel through the environment so quotes cannot change the script.
    fn write_shortcut(target: &Path, known_folder: &str) -> Result<(), String> {
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$kind = [System.Enum]::Parse([System.Environment+SpecialFolder], $env:OG_KIT_KNOWN_FOLDER); \
                 $folder = [System.Environment]::GetFolderPath($kind); \
                 if ([string]::IsNullOrWhiteSpace($folder)) { throw 'Known Folder is unavailable' }; \
                 $link = Join-Path $folder ($env:OG_KIT_SHORTCUT_NAME + '.lnk'); \
                 $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($link); \
                 $shortcut.TargetPath = $env:OG_KIT_TARGET; \
                 $shortcut.WorkingDirectory = $env:OG_KIT_WORKDIR; \
                 $shortcut.Description = $env:OG_KIT_DESCRIPTION; \
                 $shortcut.Save(); \
                 if (-not (Test-Path -LiteralPath $link -PathType Leaf)) { throw 'shortcut was not written' }",
            ])
            .env("OG_KIT_KNOWN_FOLDER", known_folder)
            .env("OG_KIT_SHORTCUT_NAME", SHORTCUT_NAME)
            .env("OG_KIT_TARGET", target)
            .env(
                "OG_KIT_WORKDIR",
                target.parent().unwrap_or(target).as_os_str(),
            )
            .env("OG_KIT_DESCRIPTION", SHORTCUT_NAME)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        Ok(())
    }

    fn remove_shortcut(known_folder: &str) {
        let _ = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$kind = [System.Enum]::Parse([System.Environment+SpecialFolder], $env:OG_KIT_KNOWN_FOLDER); \
                 $folder = [System.Environment]::GetFolderPath($kind); \
                 if (-not [string]::IsNullOrWhiteSpace($folder)) { \
                     Remove-Item -LiteralPath (Join-Path $folder ($env:OG_KIT_SHORTCUT_NAME + '.lnk')) -Force -ErrorAction SilentlyContinue \
                 }",
            ])
            .env("OG_KIT_KNOWN_FOLDER", known_folder)
            .env("OG_KIT_SHORTCUT_NAME", SHORTCUT_NAME)
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    impl ShellIntegration for WindowsShell {
        fn register(&self, plan: &InstallPlan, desktop_shortcut: bool) -> Result<(), String> {
            write_shortcut(&plan.executable, "Programs")?;

            if desktop_shortcut {
                write_shortcut(&plan.executable, "DesktopDirectory")?;
            } else {
                remove_shortcut("DesktopDirectory");
            }

            // Programs and Features reads this. Without it the Kit is a file
            // someone has to know to delete; with it, uninstalling is where a
            // person already looks.
            let key = CURRENT_USER
                .create(format!(
                    r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{UNINSTALL_KEY_NAME}"
                ))
                .map_err(|error| error.to_string())?;
            let size_kb = std::fs::metadata(&plan.executable)
                .map(|metadata| (metadata.len() / 1024) as u32)
                .unwrap_or(0);
            let quoted = format!("\"{}\"", plan.executable.display());
            for (name, value) in [
                ("DisplayName", SHORTCUT_NAME.to_owned()),
                ("DisplayVersion", env!("CARGO_PKG_VERSION").to_owned()),
                ("Publisher", "BoxAI".to_owned()),
                ("InstallLocation", plan.directory.display().to_string()),
                ("DisplayIcon", plan.executable.display().to_string()),
                ("UninstallString", format!("{quoted} --uninstall")),
                ("QuietUninstallString", format!("{quoted} --uninstall")),
            ] {
                key.set_string(name, &value)
                    .map_err(|error| error.to_string())?;
            }
            for (name, value) in [
                ("NoModify", 1u32),
                ("NoRepair", 1),
                ("EstimatedSize", size_kb),
            ] {
                key.set_u32(name, value)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        }

        fn unregister(&self, directory: &Path) -> Result<(), String> {
            // This code is running from the executable it must remove. A
            // detached system PowerShell waits for this process to leave and
            // then removes only files owned by the Kit; the directory is
            // removed only if it is empty. Environment variables keep an
            // install path containing quotes out of the script grammar.
            Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    "Wait-Process -Id $env:OG_KIT_PARENT_PID -ErrorAction SilentlyContinue; \
                     @('boxai-connect.exe', 'boxai-connect.exe.incoming', 'boxai-connect.exe.previous', 'LICENSE', 'uninstall.exe') | \
                         ForEach-Object { Remove-Item -LiteralPath (Join-Path $env:OG_KIT_INSTALL_ROOT $_) -Force -ErrorAction SilentlyContinue }; \
                     Get-ChildItem -LiteralPath $env:OG_KIT_INSTALL_ROOT -Filter 'BoxAI-Connect-*.exe' -File -ErrorAction SilentlyContinue | \
                         Remove-Item -Force -ErrorAction SilentlyContinue; \
                     Remove-Item -LiteralPath $env:OG_KIT_INSTALL_ROOT -Force -ErrorAction SilentlyContinue",
                ])
                .env("OG_KIT_PARENT_PID", std::process::id().to_string())
                .env("OG_KIT_INSTALL_ROOT", directory)
                .current_dir(std::env::temp_dir())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|error| error.to_string())?;

            remove_shortcut("Programs");
            remove_shortcut("DesktopDirectory");
            let _ = CURRENT_USER.remove_tree(format!(
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{UNINSTALL_KEY_NAME}"
            ));
            Ok(())
        }
    }
}

fn is_busy(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        // ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
        Some(5) | Some(32) | Some(33)
    ) || error.kind() == io::ErrorKind::PermissionDenied
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingShell {
        registered: Mutex<Vec<(PathBuf, bool)>>,
    }

    impl ShellIntegration for RecordingShell {
        fn register(&self, plan: &InstallPlan, desktop_shortcut: bool) -> Result<(), String> {
            self.registered
                .lock()
                .expect("record")
                .push((plan.executable.clone(), desktop_shortcut));
            Ok(())
        }

        fn unregister(&self, _directory: &Path) -> Result<(), String> {
            Ok(())
        }
    }

    struct FailingShell;

    impl ShellIntegration for FailingShell {
        fn register(&self, _plan: &InstallPlan, _desktop_shortcut: bool) -> Result<(), String> {
            Err("no shell".to_owned())
        }

        fn unregister(&self, _directory: &Path) -> Result<(), String> {
            Ok(())
        }
    }

    fn plan_for(source: &Path, directory: &Path) -> InstallPlan {
        plan_in(directory, source).expect("plan")
    }

    #[test]
    fn a_download_keeps_its_own_name_but_installs_under_the_one_the_setup_uses() {
        let downloads = tempfile::tempdir().expect("downloads");
        let programs = tempfile::tempdir().expect("programs");
        let source = downloads
            .path()
            .join("BoxAI-Connect-1.0.0-windows-x64-setup.exe");
        fs::write(&source, b"program").expect("download");

        let plan = plan_in(programs.path(), &source).expect("plan");

        assert_eq!(
            plan.executable,
            programs.path().join("boxai-connect.exe"),
            "a copy carrying a download name must install over the program, not beside it",
        );
        assert!(matches!(
            plan_in(programs.path(), &programs.path().join("anything.exe")),
            Err(InstallError::AlreadyInstalled)
        ));
    }

    #[test]
    fn installing_over_an_earlier_version_replaces_it_and_keeps_no_debris() {
        let downloads = tempfile::tempdir().expect("downloads");
        let programs = tempfile::tempdir().expect("programs");
        let source = downloads.path().join("boxai-connect.exe");
        fs::write(&source, b"version 0.4.0").expect("download");
        let installed = programs.path().join("boxai-connect.exe");
        fs::write(&installed, b"version 0.3.0").expect("previous install");

        let shell = RecordingShell::default();
        let plan = plan_for(&source, programs.path());
        assert!(plan.replaces_existing);
        let result = install(&plan, &shell, true).expect("install");

        assert_eq!(result, installed);
        assert_eq!(fs::read(&installed).expect("installed"), b"version 0.4.0");
        assert_eq!(
            fs::read_dir(programs.path())
                .expect("read")
                .map(|entry| entry.expect("entry").file_name())
                .collect::<Vec<_>>(),
            vec![std::ffi::OsString::from("boxai-connect.exe")],
            "an install leaves the program and nothing else",
        );
        assert_eq!(
            *shell.registered.lock().expect("record"),
            vec![(installed, true)],
        );
        assert!(source.exists(), "the downloaded copy is not consumed");
    }

    #[test]
    fn a_failed_registration_is_reported_rather_than_leaving_a_silent_half_install() {
        let downloads = tempfile::tempdir().expect("downloads");
        let programs = tempfile::tempdir().expect("programs");
        let source = downloads.path().join("boxai-connect.exe");
        fs::write(&source, b"program").expect("download");

        let error = install(&plan_for(&source, programs.path()), &FailingShell, false)
            .expect_err("registration failure");
        assert!(matches!(error, InstallError::ShellIntegration(_)));
    }

    #[test]
    fn uninstall_refuses_to_remove_a_directory_other_than_the_running_copy() {
        let directory = tempfile::tempdir().expect("directory");
        assert!(matches!(
            uninstall(directory.path(), &RecordingShell::default()),
            Err(InstallError::NotInstalled)
        ));
    }

    #[test]
    fn a_directory_chosen_at_setup_is_where_the_install_lives() {
        let chosen = tempfile::tempdir().expect("chosen");
        let default = tempfile::tempdir().expect("default");
        assert_eq!(
            choose_install_root(
                Some(chosen.path().to_path_buf()),
                Some(default.path().to_path_buf()),
            ),
            Some(chosen.path().to_path_buf()),
        );

        let removed = default.path().join("gone");
        assert_eq!(
            choose_install_root(Some(removed), Some(default.path().to_path_buf())),
            Some(default.path().to_path_buf()),
            "a record of a directory that no longer exists must not redirect an update",
        );
        assert_eq!(
            choose_install_root(None, Some(default.path().to_path_buf())),
            Some(default.path().to_path_buf()),
        );
    }

    #[test]
    fn a_copy_running_from_the_temporary_directory_is_told_apart_from_the_download_folder() {
        let temporary = tempfile::tempdir().expect("temp");
        let preview = temporary.path().join("archive-preview");
        fs::create_dir_all(&preview).expect("preview");
        let previewed = preview.join("boxai-connect.exe");
        fs::write(&previewed, b"program").expect("previewed program");

        let downloads = tempfile::tempdir().expect("downloads");
        let downloaded = downloads.path().join("boxai-connect.exe");
        fs::write(&downloaded, b"program").expect("downloaded program");

        if cfg!(windows) {
            assert_eq!(
                classify(&previewed, temporary.path()),
                Some(NotInstalledReason::TemporaryCopy),
            );
            assert_eq!(
                classify(&downloaded, temporary.path()),
                Some(NotInstalledReason::UnmanagedLocation),
            );
        } else {
            assert_eq!(classify(&previewed, temporary.path()), None);
            assert_eq!(classify(&downloaded, temporary.path()), None);
        }
    }
}
