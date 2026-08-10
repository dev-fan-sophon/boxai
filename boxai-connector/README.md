# BoxAI Connector

BoxAI Connector is BoxAI's independently branded GPUI control plane for projecting the BoxAI Gateway into supported external Agent clients. It does not embed an Agent runtime or run a local model relay.

## Distribution identity

| Boundary | Value |
|---|---|
| Product / window | `BoxAI Connector` |
| Binary | `boxai-connector` (`boxai-connector.exe` on Windows) |
| Bundle ID | `com.you-box.connector` |
| Manifest | `https://you-box.com/api/v1/connector/manifest` |
| Expected platform | `boxai` |
| State | `ProjectDirs("dev", "BoxAI", "BoxAI Connector")` |
| OS vault service | `com.you-box.connector` |
| Release feed boundary | `https://dl.you-box.com/connector/releases.json` |

The shared projection coordinator intentionally uses `ProjectDirs("dev", "GatewayConnector", "ProjectionCoordinator")` so independently branded Gateway connectors cannot concurrently manage the same Agent installation. It stores no Gateway credential.

Packaging icons under `packaging/icons/` are copied from the canonical coral BoxAI app-icon output generated from `logo/mark-master.png`; they do not depend on the retired BoxAI Connect distribution.

## Validation and builds

```bash
cargo fmt --all -- --check
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings

# macOS or Windows native GPUI binary
cargo build --locked --release --features connector-app/gpui-app --bin boxai-connector
```

Stage macOS on macOS:

```bash
bash packaging/stage_release.sh
```

Stage Windows from PowerShell:

```powershell
./packaging/stage_release.ps1
```

Artifacts are separated under the Connector-only `connector/` feed prefix. Publishing currently fails closed: Apple signing/notarization credentials, Windows Authenticode credentials, and a signed-artifact manifest step are not configured. Do not bypass that guard or publish unsigned archives. The tag workflow builds test artifacts only.
