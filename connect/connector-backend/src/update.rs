//! Portal release listing and the signed Connector update feed.
//!
//! An unsigned package is never installed.

use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use url::Url;

use crate::{distribution::ReleaseMetadata, install};

const MAX_JSON_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ARTIFACT_BYTES: u64 = 256 * 1024 * 1024;

// `CONNECTOR_UPDATE_PUBLIC_KEY`: the ed25519 key that must verify
// `connector_update.signature`. It is compiled from `release-metadata.json` so
// the publisher and the client cannot hold different opinions about it. The
// matching private key is a release secret and is not in this repository: it is
// the only thing that makes an update installable, which is why the packages
// themselves can stay unsigned without the updater trusting the network.
include!(concat!(env!("OUT_DIR"), "/update_public_key.rs"));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectorUpdateTarget {
    DarwinAarch64,
    WindowsX86_64,
}

impl ConnectorUpdateTarget {
    pub fn current() -> Option<Self> {
        if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            Some(Self::DarwinAarch64)
        } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
            Some(Self::WindowsX86_64)
        } else {
            None
        }
    }

    pub const fn path_segments(self) -> (&'static str, &'static str) {
        match self {
            Self::DarwinAarch64 => ("darwin", "aarch64"),
            Self::WindowsX86_64 => ("windows", "x86_64"),
        }
    }

    pub const fn release_platform(self) -> &'static str {
        match self {
            Self::DarwinAarch64 => "darwin-arm64",
            Self::WindowsX86_64 => "win32-x64",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ReleaseFile {
    pub file: String,
    pub platform: String,
    pub line: String,
    pub version: String,
    pub size: u64,
    pub sha256: String,
    pub url: String,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedUpdate {
    pub version: String,
    pub pub_date: Option<String>,
    pub notes: Option<String>,
    pub artifact_url: Url,
    pub sha256: String,
    pub size: u64,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_manual: Option<ReleaseFile>,
    pub signed: Option<SignedUpdate>,
}

impl UpdateCheck {
    pub fn has_newer_manual(&self) -> bool {
        self.latest_manual
            .as_ref()
            .is_some_and(|release| is_newer(&release.version, &self.current_version))
    }

    pub fn has_signed_install(&self) -> bool {
        self.signed.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackagedInstall {
    pub kind: InstallKind,
    pub root: PathBuf,
    pub executable: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallKind {
    MacApp,
    /// A Windows install is one executable in the managed install directory.
    /// The published artifact is the setup program that puts it there, so an
    /// update runs that setup silently over the same directory rather than
    /// reimplementing what installing means.
    WindowsExecutable,
}

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("this distribution has no download page")]
    MissingDownloadUrl,
    #[error("the download URL is not a usable portal origin")]
    InvalidDownloadUrl,
    #[error("could not initialize the HTTP client: {0}")]
    ClientSetup(reqwest::Error),
    #[error("could not reach {url}: {source}")]
    Network { url: Url, source: reqwest::Error },
    #[error("the update endpoint returned HTTP {0}")]
    HttpStatus(u16),
    #[error("the update response is too large")]
    ResponseTooLarge,
    #[error("the update response is not valid JSON")]
    InvalidSchema,
    #[error("the signed update artifact is not on the portal origin")]
    ArtifactOrigin,
    #[error("the artifact digest or signature is not valid")]
    UnverifiedArtifact,
    #[error("this build is not a packaged install")]
    NotPackaged,
    #[error("the signed archive does not contain a replaceable application")]
    InvalidArchive,
    #[error("could not replace the installed application: {0}")]
    ReplaceFailed(String),
    #[error("could not open the download page: {0}")]
    OpenDownload(String),
}

#[derive(Debug, Deserialize)]
struct ReleaseList {
    version: String,
    downloads: Vec<ReleaseDownload>,
}

#[derive(Debug, Deserialize)]
struct ReleaseDownload {
    platform: String,
    arch: String,
    filename: String,
    size: u64,
    sha256: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct SignedFeed {
    version: String,
    #[serde(default)]
    pub_date: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    platforms: BTreeMap<String, SignedFeedArtifact>,
}

#[derive(Debug, Deserialize)]
struct SignedFeedArtifact {
    url: String,
    sha256: String,
    size: u64,
    signature: String,
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    let parse = |value: &str| {
        value
            .split('-')
            .next()
            .unwrap_or(value)
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let left = parse(candidate);
    let right = parse(current);
    let len = left.len().max(right.len());
    for index in 0..len {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

pub fn portal_origin(download_url: &str) -> Result<Url, UpdateError> {
    let url = Url::parse(download_url).map_err(|_| UpdateError::InvalidDownloadUrl)?;
    if has_userinfo(&url) {
        return Err(UpdateError::InvalidDownloadUrl);
    }
    let scheme_ok = match url.scheme() {
        "https" => true,
        "http" => match url.host() {
            Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
            Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
            Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
            None => false,
        },
        _ => false,
    };
    if !scheme_ok || url.host().is_none() {
        return Err(UpdateError::InvalidDownloadUrl);
    }
    url.origin()
        .ascii_serialization()
        .parse()
        .map_err(|_| UpdateError::InvalidDownloadUrl)
}

pub fn check_updates(
    update_feed_url: &str,
    current_version: &str,
    target: ConnectorUpdateTarget,
) -> Result<UpdateCheck, UpdateError> {
    let feed_url = static_feed_url(update_feed_url)?;
    let client = client()?;
    let releases = fetch_releases(&client, &feed_url)?;
    let latest_manual = releases
        .into_iter()
        .filter(|file| file.line == "connector" && file.platform == target.release_platform())
        .max_by(
            |left, right| match is_newer(&left.version, &right.version) {
                true => std::cmp::Ordering::Greater,
                false if is_newer(&right.version, &left.version) => std::cmp::Ordering::Less,
                false => std::cmp::Ordering::Equal,
            },
        )
        .filter(|file| is_newer(&file.version, current_version));
    let signed = fetch_signed_update(&client, &feed_url, current_version, target)?;
    Ok(UpdateCheck {
        current_version: current_version.to_owned(),
        latest_manual,
        signed,
    })
}

pub fn open_download_page(metadata: Option<ReleaseMetadata>) -> Result<(), UpdateError> {
    let url = metadata
        .and_then(|value| value.download_url)
        .ok_or(UpdateError::MissingDownloadUrl)?;
    webbrowser::open(url).map_err(|error| UpdateError::OpenDownload(error.to_string()))
}

pub fn packaged_install() -> Option<PackagedInstall> {
    let executable = std::env::current_exe().ok()?;
    let executable = executable.canonicalize().unwrap_or(executable);
    if let Some(root) = executable.ancestors().find(|path| {
        path.extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    }) {
        return Some(PackagedInstall {
            kind: InstallKind::MacApp,
            root: root.to_path_buf(),
            executable,
        });
    }
    let directory = executable.parent()?;
    if cfg!(windows) && crate::install::is_install_directory(directory) {
        return Some(PackagedInstall {
            kind: InstallKind::WindowsExecutable,
            root: directory.to_path_buf(),
            executable,
        });
    }
    None
}

pub fn apply_signed_update(
    update_feed_url: &str,
    update: &SignedUpdate,
    install: &PackagedInstall,
) -> Result<PathBuf, UpdateError> {
    let origin = portal_origin(update_feed_url)?;
    if update.artifact_url.origin() != origin.origin() {
        return Err(UpdateError::ArtifactOrigin);
    }
    let client = client()?;
    let bytes = fetch_bytes(&client, update.artifact_url.clone(), MAX_ARTIFACT_BYTES)?;
    if bytes.len() as u64 != update.size {
        return Err(UpdateError::UnverifiedArtifact);
    }
    verify_artifact(&bytes, &update.sha256, &update.signature)?;
    replace_install(&bytes, install)
}

pub fn verify_artifact(
    bytes: &[u8],
    sha256_hex: &str,
    signature_b64: &str,
) -> Result<(), UpdateError> {
    verify_artifact_with_key(
        bytes,
        sha256_hex,
        signature_b64,
        &CONNECTOR_UPDATE_PUBLIC_KEY,
    )
}

pub fn verify_artifact_with_key(
    bytes: &[u8],
    sha256_hex: &str,
    signature_b64: &str,
    public_key: &[u8; 32],
) -> Result<(), UpdateError> {
    let expected = decode_hex(sha256_hex).ok_or(UpdateError::UnverifiedArtifact)?;
    if expected.len() != 32 || Sha256::digest(bytes).as_slice() != expected {
        return Err(UpdateError::UnverifiedArtifact);
    }
    let signature = BASE64
        .decode(signature_b64.trim())
        .map_err(|_| UpdateError::UnverifiedArtifact)?;
    let signature =
        Signature::from_slice(&signature).map_err(|_| UpdateError::UnverifiedArtifact)?;
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| UpdateError::UnverifiedArtifact)?;
    key.verify(bytes, &signature)
        .map_err(|_| UpdateError::UnverifiedArtifact)
}

fn fetch_releases(
    client: &reqwest::blocking::Client,
    feed_url: &Url,
) -> Result<Vec<ReleaseFile>, UpdateError> {
    let mut url = feed_url.clone();
    url.set_path(&format!(
        "{}releases.json",
        feed_url.path().trim_end_matches("native-latest.json")
    ));
    let bytes = fetch_json(client, url)?;
    let list: ReleaseList =
        serde_json::from_slice(&bytes).map_err(|_| UpdateError::InvalidSchema)?;
    let version = list.version;
    let origin = portal_origin(feed_url.as_str())?;
    list.downloads
        .into_iter()
        .filter_map(|download| {
            let platform = match (download.platform.as_str(), download.arch.as_str()) {
                ("macos", "arm64") => Some("darwin-arm64"),
                ("windows", "x86_64" | "x64") => Some("win32-x64"),
                _ => None,
            }?;
            Some((platform, download))
        })
        .map(|(platform, download)| {
            let url = resolve_same_origin(&origin, &download.url)?;
            Ok(ReleaseFile {
                file: download.filename,
                platform: platform.to_owned(),
                line: "connector".to_owned(),
                version: version.clone(),
                size: download.size,
                sha256: download.sha256,
                url: url.to_string(),
                current: true,
            })
        })
        .collect()
}

fn fetch_signed_update(
    client: &reqwest::blocking::Client,
    feed_url: &Url,
    current_version: &str,
    target: ConnectorUpdateTarget,
) -> Result<Option<SignedUpdate>, UpdateError> {
    let url = feed_url.clone();
    let response = client
        .get(url.clone())
        .send()
        .map_err(|source| UpdateError::Network {
            url: url.clone(),
            source,
        })?;
    if matches!(
        response.status(),
        reqwest::StatusCode::NO_CONTENT | reqwest::StatusCode::NOT_FOUND
    ) {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(UpdateError::HttpStatus(response.status().as_u16()));
    }
    let bytes = read_bounded(response, MAX_JSON_BYTES)?;
    let feed: SignedFeed =
        serde_json::from_slice(&bytes).map_err(|_| UpdateError::InvalidSchema)?;
    if !is_newer(&feed.version, current_version) {
        return Ok(None);
    }
    let Some(artifact) = feed.platforms.get(target.release_platform()) else {
        return Ok(None);
    };
    if artifact.signature.trim().is_empty() || artifact.sha256.len() != 64 || artifact.size == 0 {
        return Ok(None);
    }
    let origin = portal_origin(feed_url.as_str())?;
    let artifact_url = resolve_same_origin(&origin, &artifact.url)?;
    Ok(Some(SignedUpdate {
        version: feed.version,
        pub_date: feed.pub_date,
        notes: feed.notes,
        artifact_url,
        sha256: artifact.sha256.clone(),
        size: artifact.size,
        signature: artifact.signature.clone(),
    }))
}

fn static_feed_url(value: &str) -> Result<Url, UpdateError> {
    let url = Url::parse(value).map_err(|_| UpdateError::InvalidDownloadUrl)?;
    portal_origin(value)?;
    if !url.path().ends_with("/native-latest.json")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(UpdateError::InvalidDownloadUrl);
    }
    Ok(url)
}

fn fetch_json(client: &reqwest::blocking::Client, url: Url) -> Result<Vec<u8>, UpdateError> {
    let response = client
        .get(url.clone())
        .send()
        .map_err(|source| UpdateError::Network {
            url: url.clone(),
            source,
        })?;
    if !response.status().is_success() {
        return Err(UpdateError::HttpStatus(response.status().as_u16()));
    }
    read_bounded(response, MAX_JSON_BYTES)
}

fn fetch_bytes(
    client: &reqwest::blocking::Client,
    url: Url,
    limit: u64,
) -> Result<Vec<u8>, UpdateError> {
    let response = client
        .get(url.clone())
        .send()
        .map_err(|source| UpdateError::Network {
            url: url.clone(),
            source,
        })?;
    if !response.status().is_success() {
        return Err(UpdateError::HttpStatus(response.status().as_u16()));
    }
    read_bounded(response, limit)
}

fn read_bounded(response: reqwest::blocking::Response, limit: u64) -> Result<Vec<u8>, UpdateError> {
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(UpdateError::ResponseTooLarge);
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|source| UpdateError::ReplaceFailed(source.to_string()))?;
    if bytes.len() as u64 > limit {
        return Err(UpdateError::ResponseTooLarge);
    }
    Ok(bytes)
}

fn resolve_same_origin(origin: &Url, value: &str) -> Result<Url, UpdateError> {
    let url = origin.join(value).map_err(|_| UpdateError::InvalidSchema)?;
    if url.origin() != origin.origin() || has_userinfo(&url) {
        return Err(UpdateError::ArtifactOrigin);
    }
    Ok(url)
}

fn replace_install(bytes: &[u8], install: &PackagedInstall) -> Result<PathBuf, UpdateError> {
    let staging =
        tempfile::tempdir().map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
    match install.kind {
        InstallKind::MacApp => {
            let bundle = copy_app_from_disk_image(bytes, staging.path())?;
            replace_path(&bundle, &install.root)?;
            Ok(install.executable.clone())
        }
        InstallKind::WindowsExecutable => {
            // The downloaded artifact is the setup program people run by hand.
            // Refusing anything that is not a Windows executable keeps a
            // mis-published archive from being run over a working install.
            if !is_windows_executable(bytes) {
                return Err(UpdateError::InvalidArchive);
            }
            let setup = staging.path().join("boxai-connect-setup.exe");
            fs::write(&setup, bytes)
                .map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
            run_silent_setup(&setup, &install.root)?;
            // The setup decides the installed name, and the copy that is
            // running may not carry it: an install made by an earlier version
            // kept the downloaded file's name. Relaunching what was running
            // would then start the old program and report a successful update.
            let installed = install.root.join(install::EXECUTABLE_NAME);
            if !installed.exists() {
                return Err(UpdateError::ReplaceFailed(format!(
                    "the setup program left no executable at {}",
                    installed.display()
                )));
            }
            Ok(installed)
        }
    }
}

/// Runs the downloaded setup program over the existing install.
///
/// One file is published, so the update installs itself exactly the way a
/// person installing by hand would: same directory layout, same Start menu
/// entry, same uninstall record, written by the same code. `/S` is NSIS's
/// silent mode and `/D=` sets the target directory; NSIS requires `/D` to be
/// last and takes the rest of the line literally, so the path is passed
/// unquoted.
///
/// The installed program is running while this happens. The setup renames the
/// old executable aside rather than overwriting it, which Windows allows for a
/// running image, so the caller can relaunch and exit afterwards.
fn run_silent_setup(setup: &Path, root: &Path) -> Result<(), UpdateError> {
    let status = Command::new(setup)
        .arg("/S")
        .arg(format!("/D={}", root.display()))
        .status()
        .map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
    if !status.success() {
        return Err(UpdateError::ReplaceFailed(format!(
            "the setup program exited with {status}"
        )));
    }
    Ok(())
}

/// The macOS release is the disk image people download by hand, so an update
/// reads the same artifact rather than a second packaging of the same build.
/// The image is mounted read-only and without a Finder window, its one bundle
/// is copied out, and it is detached before anything in the install moves —
/// a replacement must never depend on a volume that could still be attached.
fn copy_app_from_disk_image(bytes: &[u8], dest: &Path) -> Result<PathBuf, UpdateError> {
    let image = dest.join("artifact.dmg");
    fs::write(&image, bytes).map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
    let mount = dest.join("mount");
    fs::create_dir(&mount).map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;

    let status = Command::new("/usr/bin/hdiutil")
        .arg("attach")
        .arg(&image)
        .args(["-readonly", "-nobrowse", "-noautoopen", "-mountpoint"])
        .arg(&mount)
        .arg("-quiet")
        .status()
        .map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
    if !status.success() {
        return Err(UpdateError::InvalidArchive);
    }

    let copied = (|| {
        let app = find_suffix(&mount, "app").ok_or(UpdateError::InvalidArchive)?;
        let name = app.file_name().ok_or(UpdateError::InvalidArchive)?;
        let copied = dest.join(name);
        // -R preserves the bundle's symlinks and executable bits; a rewrite
        // that flattened them would install an app that cannot launch.
        let status = Command::new("/bin/cp")
            .arg("-R")
            .arg(&app)
            .arg(&copied)
            .status()
            .map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
        if !status.success() {
            return Err(UpdateError::InvalidArchive);
        }
        Ok(copied)
    })();

    let detached = Command::new("/usr/bin/hdiutil")
        .arg("detach")
        .arg(&mount)
        .arg("-quiet")
        .status();
    if !matches!(detached, Ok(status) if status.success()) {
        let _ = Command::new("/usr/bin/hdiutil")
            .arg("detach")
            .arg(&mount)
            .args(["-force", "-quiet"])
            .status();
    }
    copied
}

/// A PE image starts with the `MZ` DOS header and carries the offset of its
/// `PE\0\0` signature at 0x3C. Checking both rejects a ZIP, an HTML error
/// page, or a truncated download without executing anything.
pub fn is_windows_executable(bytes: &[u8]) -> bool {
    if bytes.len() < 0x40 || &bytes[..2] != b"MZ" {
        return false;
    }
    let offset = u32::from_le_bytes([bytes[0x3c], bytes[0x3d], bytes[0x3e], bytes[0x3f]]) as usize;
    bytes
        .get(offset..offset + 4)
        .is_some_and(|signature| signature == b"PE\0\0")
}

fn find_suffix(root: &Path, extension: &str) -> Option<PathBuf> {
    let mut found = None;
    for entry in fs::read_dir(root).ok()? {
        let path = entry.ok()?.path();
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(extension))
        {
            if found.is_some() {
                return None;
            }
            found = Some(path);
        }
    }
    found
}

fn backup_path(dest: &Path) -> PathBuf {
    dest.with_extension(format!(
        "{}.previous",
        dest.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("bak")
    ))
}

fn replace_path(source: &Path, dest: &Path) -> Result<(), UpdateError> {
    let backup = backup_path(dest);
    if dest.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(dest, &backup).map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
    }
    let result = if source.is_dir() {
        copy_dir(source, dest)
    } else {
        fs::copy(source, dest)
            .map(|_| ())
            .map_err(|error| UpdateError::ReplaceFailed(error.to_string()))
    };
    if result.is_ok() {
        let _ = fs::remove_dir_all(&backup);
        let _ = fs::remove_file(&backup);
    } else if backup.exists() {
        let _ = fs::rename(&backup, dest);
    }
    result
}

fn copy_dir(source: &Path, dest: &Path) -> Result<(), UpdateError> {
    fs::create_dir_all(dest).map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
    for entry in
        fs::read_dir(source).map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?
    {
        let entry = entry.map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|error| UpdateError::ReplaceFailed(error.to_string()))?;
        }
    }
    Ok(())
}

fn client() -> Result<reqwest::blocking::Client, UpdateError> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("BoxAI-Connect/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(UpdateError::ClientSetup)
}

fn has_userinfo(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(value.get(index..index + 2)?, 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn newer_versions_compare_numerically() {
        assert!(is_newer("0.2.0", "0.1.10"));
        assert!(!is_newer("0.1.9", "0.1.10"));
        assert!(!is_newer("0.2.0", "0.2.0"));
    }

    #[test]
    fn portal_origin_keeps_https_and_loopback() {
        assert_eq!(
            portal_origin("https://you-box.com/connect")
                .expect("origin")
                .as_str(),
            "https://you-box.com/"
        );
        assert!(portal_origin("http://127.0.0.1:8787/kit#download").is_ok());
        assert!(portal_origin("http://example.com/kit").is_err());
        assert!(portal_origin("https://user:pass@you-box.com/connect").is_err());
    }

    #[test]
    fn signed_bytes_verify_only_with_the_matching_key() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let bytes = b"connector-update-fixture";
        let digest = format!("{:x}", Sha256::digest(bytes));
        let signature = BASE64.encode(signing.sign(bytes).to_bytes());
        verify_artifact_with_key(
            bytes,
            &digest,
            &signature,
            signing.verifying_key().as_bytes(),
        )
        .expect("matching key");
        assert!(
            verify_artifact_with_key(bytes, &digest, &signature, &CONNECTOR_UPDATE_PUBLIC_KEY)
                .is_err()
        );
        assert!(
            verify_artifact_with_key(
                b"tampered",
                &digest,
                &signature,
                signing.verifying_key().as_bytes()
            )
            .is_err()
        );
    }

    #[test]
    fn check_updates_reads_releases_and_treats_a_portal_without_signed_feed_as_manual_only() {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("server");
        let feed = format!("http://{}/connect/native-latest.json", server.server_addr());
        let worker = std::thread::spawn(move || {
            for _ in 0..2 {
                let request = server.recv().expect("request");
                if request.url() == "/connect/releases.json" {
                    let body = serde_json::json!({
                        "version": "1.1.0",
                        "downloads": [{
                            "platform": "macos",
                            "arch": "arm64",
                            "kind": "dmg",
                            "filename": "BoxAI-Connect-1.1.0-macos-arm64.dmg",
                            "size": 10,
                            "sha256": "a".repeat(64),
                            "url": "/connect/1.1.0/BoxAI-Connect-1.1.0-macos-arm64.dmg"
                        }]
                    });
                    request
                        .respond(tiny_http::Response::from_string(body.to_string()))
                        .expect("releases");
                } else {
                    request
                        .respond(tiny_http::Response::empty(404))
                        .expect("signed feed not deployed");
                }
            }
        });
        let check =
            check_updates(&feed, "1.0.0", ConnectorUpdateTarget::DarwinAarch64).expect("check");
        worker.join().expect("server");
        assert_eq!(
            check
                .latest_manual
                .as_ref()
                .map(|release| release.version.as_str()),
            Some("1.1.0")
        );
        assert!(check.has_newer_manual());
        assert!(check.signed.is_none());
    }

    /// The published macOS artifact is a disk image, so the update path has to
    /// read one; extracting it as an archive would fail on every real release.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_macos_update_takes_its_bundle_out_of_the_published_disk_image() {
        let source = tempfile::tempdir().expect("source");
        // The staged layout the release script hands to hdiutil: the bundle
        // beside the drop target, not a bare bundle.
        let stage = source.path().join("stage");
        let bundle = stage.join("BoxAI Connect.app");
        let macos = bundle.join("Contents/MacOS");
        fs::create_dir_all(&macos).expect("bundle");
        fs::write(macos.join("boxai-connect"), b"new binary").expect("binary");
        fs::write(bundle.join("Contents/Info.plist"), b"<plist/>").expect("plist");
        std::os::unix::fs::symlink("/Applications", stage.join("Applications")).expect("link");
        let image = source.path().join("release.dmg");
        let created = Command::new("/usr/bin/hdiutil")
            .arg("create")
            .args(["-volname", "BoxAI Connect", "-srcfolder"])
            .arg(&stage)
            .args(["-fs", "HFS+", "-format", "UDZO", "-ov", "-quiet"])
            .arg(&image)
            .status()
            .expect("hdiutil");
        assert!(created.success(), "could not build the test disk image");

        let staging = tempfile::tempdir().expect("staging");
        let copied = copy_app_from_disk_image(&fs::read(&image).expect("image"), staging.path())
            .expect("bundle copied out of the image");

        assert_eq!(copied.file_name().expect("name"), "BoxAI Connect.app");
        assert_eq!(
            fs::read(copied.join("Contents/MacOS/boxai-connect")).expect("binary"),
            b"new binary"
        );
        let still_mounted: Vec<_> = fs::read_dir(staging.path().join("mount"))
            .expect("mount point")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert!(
            still_mounted.is_empty(),
            "the image must be detached once its bundle has been copied out: {still_mounted:?}"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_macos_update_refuses_bytes_that_are_not_a_disk_image() {
        let staging = tempfile::tempdir().expect("staging");
        assert!(matches!(
            copy_app_from_disk_image(b"not a disk image", staging.path()),
            Err(UpdateError::InvalidArchive)
        ));
    }

    #[test]
    fn a_debug_binary_is_not_a_packaged_install() {
        let exe = std::env::current_exe().expect("exe");
        let packaged = exe.ancestors().any(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        }) || (cfg!(windows)
            && exe
                .parent()
                .is_some_and(|parent| parent.join("release-metadata.json").is_file()));
        if !packaged {
            assert!(packaged_install().is_none());
        }
    }
}
