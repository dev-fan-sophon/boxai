# BoxAI Vetta integration

BoxAI Desktop (`desktop/`, Tauri + Python) is replaced by a fork of
[openvetta/open-vetta](https://github.com/openvetta/open-vetta) `v0.5.59`.
BoxAI Connect (`connect/`) stays. It configures other coding agents; Open Vetta
does not, and must not be asked to.

The client lives in its own repository, `dev-fan-sophon/boxai-vetta`. Until the
org GitHub token can create that repo, the working copy is
`/Users/fan/src/boxai-vetta` on the Mac runner. Windows verification uses
`C:\Users\win\src\boxai-vetta`. Do not subtree the client into this repository.

Implementation thread: https://ampcode.com/threads/T-01a0d316-5da8-7200-b609-3f32b71ba5ce
Windows host prep: https://ampcode.com/threads/T-01a0d316-bd03-77e2-bd79-ba57f131128e

## What stays in this repository

- Go gateway, `/api/desktop/*` PKCE, `/v1/*`, `/mcp`
- Cloudflare connector broker at `api-desktop.you-box.com`
- Connect client, catalog, and `dl.you-box.com/connect/*`
- Website download page, which keeps reading
  `https://dl.you-box.com/desktop/releases.json`
- Session revoke UI at `/api/desktop/sessions`

`desktop/` is deleted only after the new client has passed native macOS and
Windows verification and a signed feed can replace the old Tauri artifacts.
Do not delete it in the same change that only documents the plan.

## Identity

| Surface | Value |
| --- | --- |
| Product | BoxAI |
| `client_id` | `boxai-desktop` |
| appId / bundle id | `com.you-box.desktop` |
| protocol | `boxai://` (not used for login) |
| data dir | `~/.boxai` |
| API origin | `https://you-box.com` |
| web origin | `https://you-box.com` |
| model base | `https://you-box.com/v1` |
| update feed | `https://dl.you-box.com/desktop/` |
| website manifest | `https://dl.you-box.com/desktop/releases.json` |

Internal `@vetta/*` package names and `vetta:` IPC channel strings stay. Users
never see them. Renaming them is not part of this integration.

## Login

Do not implement Open Vetta's `vetta://oauth/callback?access_token=` flow, and
do not set `VETTA_CLOUD_ENABLED=true`. That path is compiled against a private
server that is not in the open-vetta tree.

Login is the existing BoxAI PKCE contract:

1. Listen on `http://127.0.0.1:<port>/auth/callback` with an empty query and
   fragment. The gateway rejects every other redirect.
2. `POST /api/desktop/authorization-requests` with
   `client_id=boxai-desktop`, `code_challenge_method=S256`, a 43-character
   base64url challenge, and a state of 22–128 unreserved characters.
3. Open `https://you-box.com/desktop/authorize?request=<id>` in the system
   browser. The page returns `redirect_uri` with `code` and `state`, or
   `error=access_denied`.
4. `POST /api/desktop/token` with `grant_type=authorization_code`. The response
   is `access_token`, rotating `refresh_token`, `api_key` (`sk-...`),
   `expires_in`, and `base_url` (`https://you-box.com/v1`).
5. Store the refresh token and `sk-` in the OS credential store. Do not write
   them to `auth.json` or `settings.json`.
6. Refresh with `POST /api/desktop/refresh`. Revoke with
   `POST /api/desktop/revoke` before deleting the local session. Revoke failure
   keeps the user signed in.

The issued `base_url` must equal `https://you-box.com/v1`. Any other value is
an invalid session; discard it and require sign-in again.

## Model policy

A signed-in session is the only model credential. The distribution build must
reject, at both the UI and the request path:

- user-supplied API keys and custom `baseUrl`
- Ollama, LM Studio, vLLM, and other local inference endpoints
- provider OAuth for Anthropic, Codex, Copilot, Gemini CLI, and Antigravity
- the content-creation plugin's separate `customApiKey` / `customBaseUrl`

Chat uses `openai-completions` against `https://you-box.com/v1` with
`Authorization: Bearer <api_key>`. Model listing is `GET /v1/models` with the
same key. Image generation uses `POST /v1/images/generations` with the same
key. Media tools may also use `https://you-box.com/mcp` with that bearer token.
Do not ask the user for a second key.

## Release feed

electron-updater reads `latest-mac.yml` and `latest.yml` from
`https://dl.you-box.com/desktop/`. The website keeps reading `releases.json`
in the shape already produced by `desktop/packaging/make_release_manifests.py`:
`version`, `published_at`, `notes`, and `downloads[]` with `platform`, `arch`,
`kind`, `signed`, `minimum_os`, `url`, `filename`, `size`, `sha256`.

Artifact names:

- `BoxAI-<version>-macos-arm64.dmg`
- `BoxAI-<version>-windows-x64-setup.exe`

`signed` is `false` until Developer ID notarization and Authenticode exist.
Do not claim either.

`scripts/client-release/vetta_release_manifest.py` writes that `releases.json`
from a staged directory. The old Tauri `latest.json` is not the in-app feed
anymore. Do not point electron-updater at it.

## License

Apache-2.0. Ship `LICENSE` and `NOTICE`. Mark modified files. Do not use the
Vetta trademark as the product name.
