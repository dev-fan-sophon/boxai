# BoxAI Connect

BoxAI Connect is the native GPUI client for configuring Claude Code, Codex,
Gemini CLI, Grok Build, and OpenCode with BoxAI. It includes model discovery,
per-Agent configuration, MCP server and Skill management, reversible apply and
disconnect operations, account usage, and signed self-updates.

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
