# BoxAI Connect

BoxAI Connect is the native GPUI client for configuring Claude Code, Codex,
Gemini CLI, Grok Build, and OpenCode with BoxAI. Choose an Agent, search the
current model catalog, then Apply. Advanced options retain per-Agent protocol,
Codex runtime, MCP and Skill controls. Restore returns backed-up Agent files
without signing out; revoke-device authorization restores configuration and
removes the local credential. Quit or close the last window leaves configured
Agents intact and stops Connect. There is no background service.

Account and billing open in the browser. Startup does not request dashboard
usage or download Skill archives. Skills download on demand and reuse verified
digest-addressed archives. A profile/platform/origin-bound, credential-free
catalog remains inspectable offline; it is not authorization to Apply.

Browser sign-in uses the deployed BoxAI PKCE contract. Credentials live in
macOS Keychain or Windows Credential Manager. Legacy profile secrets migrate
only after verified native-store read-back; failed cleanup remains retryable.
English and Vietnamese are supported; retired Chinese preferences migrate to
English. WorkBuddy is excluded from the distribution, while its old backups
remain restorable.

The source is based on OriginGame's latest GPUI bkit design. Exact upstream
revisions and licensing are recorded in [`UPSTREAM.md`](UPSTREAM.md). Neutral
projection lock and lease identities intentionally remain vendor-neutral so
another compatible Connector cannot concurrently own the same Agent install.

```sh
cargo run --locked -p gateway-connector-app --bin boxai-connect
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

`cargo run` is a bare Mach-O, so macOS has no bundle `icns`. The host paints
the Dock tile from `connector-app/packaging/icon.png` — the same master the
staged `.app` turns into `BoxAIConnect.icns`.

Native staging:

```sh
# Native Apple Silicon macOS only. This builds, packages, and writes the
# assertion beside the versioned DMG in release/<version>/.
bash packaging/macos/stage-release.sh
```

Windows x64 staging must run on a native Windows host:

```powershell
# This builds, packages, and writes the assertion beside the versioned setup.
./packaging/windows/stage-release.ps1
```

Both native artifacts and both assertion reports must be combined in
`release/<version>/`. The publisher verifies the reports and Ed25519 key,
signs the exact installer bytes, uploads immutable artifacts, and advances both
complete feeds:

```sh
bash packaging/publish_release.sh
```

- `https://dl.you-box.com/connect/releases.json` drives the website downloads.
- `https://dl.you-box.com/connect/native-latest.json` drives signed in-app updates.
- `https://you-box.com/connect` remains the public download page.

The current DMG and NSIS setup are unsigned and the macOS app is not notarized.
The in-app updater independently requires a valid Ed25519 signature. Do not
describe the OS packages as signed until platform signing is introduced.

## Offline native acceptance

The optional `acceptance` feature is for local rendering/resource checks only;
never pass it to packaging. Normal production builds still reject isolated
launches. Use a dedicated Cargo target directory, then run:

```sh
cargo build --locked --features acceptance --bin boxai-connect
"$CARGO_TARGET_DIR/debug/boxai-connect" --acceptance-root /absolute/new/fixture-root
```

On Windows use `$env:CARGO_TARGET_DIR` and `debug/boxai-connect.exe`. The root
must be new/empty or have a valid isolation marker. Profiles, preferences,
Agent roots and the projection coordinator resolve only inside that root.
This read-only fixture bypasses normal resume/authentication and update checks,
has no credentials, and disables network/install/apply/revoke actions. It is
not evidence of live authorization or Agent mutation. Change language in
Settings to exercise English/Vietnamese and relaunch the same root to check
persistence; its preference file is `data/ui-preferences.json`.

Test the actual native credential store separately with a disposable random
identity (no network, installed profile or Agent access):

```sh
cargo run --locked -p gateway-connector-backend --example native_vault_probe
```

## BoxAI Media and official Skills

[`catalog.json`](catalog.json) defines the BoxAI Media MCP server and the three
official Skills under [`skills/`](skills/). Build reproducible archives and
verify their committed hashes with:

```sh
python3 packaging/build_catalog.py
```

After the matching BoxAI backend is deployed, publish the immutable archives
and atomically activate the complete production catalog with:

```sh
bash packaging/publish_catalog.sh
```
