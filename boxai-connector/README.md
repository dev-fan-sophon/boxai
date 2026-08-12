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

BoxAI-specific authentication, provisioning, account, usage, billing, Model Plaza, packaging, and release identity stay in this repository. The protocol projection contract is adapted from neutral GatewayConnector upstream commit `8d63acb0facbfd9f70179dbeb47478031fd4d36e` (with follow-up `bdc03cad32c6cfc96993c177831cb8d124f1aa2f`) rather than branding the neutral upstream repository as BoxAI.

## Agent protocol configuration

Model and protocol choices are stored independently for every Agent. `Auto` uses a stable Agent-specific preference and only resolves to a protocol advertised by the BoxAI manifest.

| Agent | Available protocols |
|---|---|
| Claude Code | Anthropic Messages |
| Codex CLI | OpenAI Responses |
| Gemini CLI | Gemini |
| Grok Build | OpenAI Chat Completions, OpenAI Responses, Anthropic Messages |
| OpenCode | OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Gemini |

Legacy model-only state is migrated without changing the protocol that the previous Connector actually projected: Claude → Anthropic, Codex/Grok Build → Responses, Gemini → Gemini, and OpenCode → Chat Completions.

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
