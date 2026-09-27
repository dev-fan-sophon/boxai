# BoxAI Connect

BoxAI Connect 2 uses Go and Wails native webviews, adapted from Magpie.
Product identity remains `com.you-box.connect`; the executable is
`boxai-connect` (`boxai-connect.exe` on Windows). See [UPSTREAM.md](UPSTREAM.md)
for pinned source and retained license notices.

## Account and configuration lifecycle

Sign in through the BoxAI browser flow before accessing models, Agents, MCP
servers or Skills. Account credentials stay in macOS Keychain or Windows
Credential Manager; there is no plaintext fallback. Linux builds are for
development checks and fail closed when native credential storage is unavailable.

Only account-authorized BoxAI models and the official provisioning catalog can
be applied. Keep Connect running: configured Agents use its authenticated
loopback gateway, not the account credential. Third-party provider imports,
subscription logins, public marketplaces and Magpie sync/backup workflows are
not supported product entrypoints.

The first authenticated use restores supported legacy Rust Connect projections
under the same neutral ownership lock. Original profiles and encrypted receipt
backups remain available; old model choices are not automatically applied to
the new client. Select the desired authorized models and official resources
explicitly. Missing original native secrets, conflicting external edits or
unrecoverable legacy journals block migration rather than overwriting files.

Signing out first restores Connect-owned model/MCP/Skill changes, then revokes
the device session and deletes its credentials. A failed restore or revocation
leaves sign-out pending across restarts; resolve the reported conflict and retry
sign-out. Do not delete the original vault entry or receipt to bypass recovery.

## Development and checks

Use the Go version declared in `go.mod` (1.26.3 or newer).

```sh
make test       # Go vet/tests and packaging schema tests; needs native webview headers
make cli        # terminal-only development binary, not a release installer
make build     # native Wails GUI; Linux needs GTK3 and WebKitGTK 4.1 headers
make dev
```

Native GUI builds use the embedded `internal/gui/assets`; no separate web
bundle or Rust toolchain is involved. The committed Windows icon renditions
and native macOS icon generation use `../logo/exports/app-icon-connect-1024.png`.
To regenerate the Windows renditions with ImageMagick, run from `connect/`:

```sh
for size in 16 32 48 64 128 256; do
  magick ../logo/exports/app-icon-connect-1024.png -resize ${size}x${size} build/windows/icon-${size}.png
done
```

## Native release staging

`release-metadata.json` is the version and artifact source of truth. Native
acceptance must run on each target OS; a Linux compile is not native acceptance.

```sh
# Native Apple Silicon Mac, with Xcode command line tools:
bash packaging/macos/stage-release.sh
```

```powershell
# Native Windows x64, with Go, NSIS, 7-Zip, and WebView2 installed:
./packaging/windows/stage-release.ps1
```

The scripts build `BoxAI-Connect-2.0.0-macos-arm64.dmg` and
`BoxAI-Connect-2.0.0-windows-x64-setup.exe`, respectively, together with
`<artifact>.assertion.json` in `release/2.0.0/`. Assertions inspect actual
Mach-O/PE architecture, bundle/resource identity and installer payload. Never
write an assertion manually or reuse it for different bytes. Both licenses
(`LICENSE` for retained Apache-derived code and `LICENSE.magpie`) ship in packages.

The current packages are unsigned and not notarized. Staging and publishing
reject metadata claiming otherwise; platform signing requires corresponding
native verification before changing that policy. Ad-hoc Mach-O signatures are
not Developer ID signing or notarization.

## Update trust and publication

The updater reads only `https://dl.you-box.com/connect/native-latest.json`.
It rejects non-BoxAI origins, unsafe URL forms, unsupported targets, missing
signatures, incorrect sizes/hashes, and invalid Ed25519 signatures over the
**exact installer bytes**. The trust anchor matches the existing BoxAI feed.
No environment variable can replace the feed or key. Downloading does not
install anything; user-initiated handoff opens the verified DMG/setup UI.
Connect does not elevate, silently replace itself, or use Magpie releases.

With explicit publication authorization, combine both native stages, then use
`packaging/publish_release.sh`. It requires matching assertions and the BoxAI
Ed25519 private key, uploads immutable artifacts first, and advances both feeds:

- `https://dl.you-box.com/connect/releases.json` (website)
- `https://dl.you-box.com/connect/native-latest.json` (updater)

`https://you-box.com/connect` remains the download page. Source changes alone
do not publish; do not trigger release workflows merely to test packaging.

## Official catalog

`python3 packaging/build_catalog.py` builds deterministic official Skill ZIPs.
`packaging/publish_catalog.sh` publishes them and activates the catalog only
after explicit production authorization.
