---
title: Codex desktop with a custom BoxAI API
summary: Configure the current Codex desktop client with config.toml and auth.json, use BoxAI Responses models, and verify which provider is billed.
section: clients
order: 30
audience: [user, developer]
updated: 2026-09-05
status: published
---

## Version checked

Checked on **September 5, 2026** against OpenAI's live [production macOS update feed](https://persistent.oaistatic.com/codex-app-prod/appcast.xml): **26.901.41600, build 7982**, published at **02:13 UTC / 09:13 Vietnam time**. We also inspected the downloaded package's version metadata and bundled Codex binary, which contains version **0.153.4**. The current package is named `ChatGPT.app`; OpenAI's documentation now refers to Codex inside the ChatGPT desktop app.

This is a dated compatibility guide, not a promise that this version remains the newest forever. Use the app's update check and About screen before following it. A separately installed `codex --version` reports the CLI, **not your desktop app version**. Windows instructions below use the same configuration schema; we have not independently verified the newest Windows Store build number. Package/configuration inspection does not constitute a native macOS or Windows GUI end-to-end test.

## Before you start

- Create a **BoxAI inference API key** in [API keys](/console/token), with enough balance and permission for your chosen model. Do not use a BoxAI administrator token, ChatGPT session token, or another provider's key.
- Confirm the exact model ID in [Model Hub](/pricing). The example uses `gpt-6-astra`; replace it if your key cannot access it.
- This guide configures **local desktop tasks**, billed to BoxAI. It does not make ChatGPT cloud tasks or remote-control features available with a BoxAI key.
- Fully quit the desktop app before editing. Back up existing `config.toml` and `auth.json` privately. These settings may also affect the CLI and IDE extension sharing the same Codex home. Do not replace unrelated MCP, project, or safety settings.

## 1. Open the user configuration directory

| System  | Default directory                                  |
| ------- | -------------------------------------------------- |
| macOS   | `~/.codex/` — in Finder, use Go → Go to Folder     |
| Windows | `%USERPROFILE%\.codex\` — paste into File Explorer |

If `CODEX_HOME` is set for the app, use that directory instead. Use **user-level** configuration, not a repository's `.codex/config.toml`: current clients restrict project-level provider/authentication overrides.

Create `config.toml` and `auth.json` if missing. Save as plain text with those exact filenames, not `config.toml.txt` or `auth.json.txt`.

## 2. Configure config.toml

This is the **file-based API-login recipe**. Merge these settings into your user configuration. Top-level keys must appear **before any `[table]` header**; replace existing keys rather than duplicating them.

```toml
model_provider = "boxai"
model = "gpt-6-astra"
model_reasoning_effort = "high"

# Keep this Codex home in API-key mode, not ChatGPT login mode.
forced_login_method = "api"
# Make the auth.json file in the next step the credential source.
cli_auth_credentials_store = "file"

[model_providers.boxai]
name = "BoxAI"
base_url = "https://you-box.com/v1"
wire_api = "responses"
requires_openai_auth = true
supports_websockets = false
```

**Do not miss `forced_login_method = "api"`.** It belongs at the top level, not inside `[model_providers.boxai]`. In this recipe it prevents an existing ChatGPT login from being used instead of the API-key login. It is **not a setting newly introduced in 26.901.41600**: OpenAI added the login restriction in 2025. It is also not universally required for every custom provider; the environment-key alternative below uses a different authentication path.

| Setting                               | Why it is here                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model_provider = "boxai"`            | Must exactly match the suffix of `[model_providers.boxai]`. Do not redefine the reserved `openai` provider.                                                                                       |
| `base_url`                            | Use `https://you-box.com/v1`, not `/v1/responses`. Codex appends `/responses`.                                                                                                                    |
| `wire_api = "responses"`              | Current Codex uses the Responses protocol. Old `wire_api = "chat"` examples are not supported.                                                                                                    |
| `requires_openai_auth = true`         | Uses Codex's cached API-login credential from `auth.json` for this recipe. It does **not** change the destination to OpenAI; `base_url` selects BoxAI. Do not combine this recipe with `env_key`. |
| `supports_websockets = false`         | Uses HTTP/SSE instead of assuming the gateway supports Responses WebSockets. Streaming still works over SSE.                                                                                      |
| `cli_auth_credentials_store = "file"` | Avoids an OS keyring entry taking precedence over the file you edited. The file contains a plaintext secret, so protect it.                                                                       |

`model_reasoning_effort` is optional and model-dependent. Astra supports `low`, `medium`, `high`, `xhigh`, and `max`; it does not support `none`. Do not copy context limits or reasoning settings from a different model. Do not add sandbox-bypass settings: they are unrelated to configuring an API provider.

## 3. Configure auth.json

For this API-only setup, save the following object in the same directory. Replace the placeholder with your **own BoxAI API key**. Do not copy ChatGPT refresh/access tokens into this object.

```json
{
  "auth_mode": "apikey",
  "OPENAI_API_KEY": "REPLACE_WITH_YOUR_BOXAI_API_KEY"
}
```

Both the spelling of `auth_mode = apikey` and the JSON field name `OPENAI_API_KEY` matter. The field name is Codex's credential format; the value is a **BoxAI** key for the configured BoxAI endpoint. JSON does not support comments or trailing commas.

On macOS, restrict access after saving:

```bash
chmod 700 ~/.codex
chmod 600 ~/.codex/config.toml ~/.codex/auth.json
```

On Windows, keep these files in your private user profile and restrict their file permissions to your account. Never commit, upload, screenshot, or share `auth.json`. Keep backups equally private. Do not use `codex login` with ChatGPT after this setup unless you intend to switch authentication modes.

## 4. Restart and verify a new local task

1. Fully quit and reopen the desktop app; closing a window alone may leave the app running.
2. Create a **new local task**. Existing conversations may retain their original model/provider; do not use an old conversation to validate a provider change.
3. Select `gpt-6-astra` if the picker offers it, and send a small request such as “Reply with OK.” A model response by itself does not prove which provider handled it.
4. Open [BoxAI usage logs](/console/log). Check the new request's time, model name, token usage, and charge. A matching successful entry is the decisive evidence that BoxAI handled the request.
5. Confirm no unexpected request appeared in another provider's billing history. Never rely only on a model label in the desktop UI.

If the app still shows a login screen, check the files, `CODEX_HOME`, and API mode first. Current OpenAI documentation calls the API-key login entry **Sign in another way**. Do not switch to ChatGPT login to bypass a custom-provider error, and do not submit your BoxAI key to an unrelated website.

## Alternative: use an environment key

Use this **instead of**, not together with, the file-based recipe when you can reliably supply an environment variable to the actual desktop/app-server process:

```toml
model_provider = "boxai"
model = "gpt-6-astra"
model_reasoning_effort = "high"

[model_providers.boxai]
name = "BoxAI"
base_url = "https://you-box.com/v1"
wire_api = "responses"
env_key = "BOXAI_API_KEY"
requires_openai_auth = false
supports_websockets = false
```

Set `BOXAI_API_KEY` securely in the environment inherited by the desktop/app-server process, then fully restart it. Merely exporting a variable in a terminal does not guarantee an app opened from Finder, Dock, or the Windows Start menu can read it. This alternative does not need a BoxAI key in `auth.json`; do not delete existing credentials unnecessarily. Remove the file-recipe's `forced_login_method` restriction if you intend to retain ChatGPT-authenticated features. Those features have separate eligibility requirements; this configuration does not guarantee their availability.

## Common problems and outdated advice

| Symptom                                       | Check                                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Still uses ChatGPT or the wrong provider      | Check top-level `model_provider`, `forced_login_method`, active Codex home, and start a new task. Check BoxAI usage logs.                                                                                 |
| `401` / invalid key                           | Use a BoxAI inference key. For file mode, check `auth_mode`, `OPENAI_API_KEY`, and `cli_auth_credentials_store`. For environment mode, check the app process has the variable without printing its value. |
| `404` / unsupported endpoint                  | Use the base `/v1` URL and `wire_api = "responses"`; do not append `/responses` yourself or use `"chat"`.                                                                                                 |
| Model unavailable                             | Check the exact ID, enabled group, key permissions, and balance in BoxAI. A model appearing in a custom catalog does not grant access.                                                                    |
| Model picker missing or wrong                 | Desktop releases have had custom-provider picker/routing limitations. Update the app, restart, and use a new task. Do not edit Codex's SQLite database to force a model.                                  |
| Configuration ignored                         | Check duplicate TOML keys, table placement, `CODEX_HOME`, profile/managed configuration, and whether the app actually restarted.                                                                          |
| WebSocket handshake errors                    | Keep `supports_websockets = false` unless your chosen endpoint's WebSocket support has been verified.                                                                                                     |
| Cloud or remote-control feature stops working | API-key mode is not ChatGPT cloud authentication. Restore your private backup if returning to ChatGPT login; review the provider as well as the credential settings.                                      |

`model_catalog_json` is an **optional top-level custom model catalog**, not a newly mandatory authentication flag. It replaces the catalog and uses Codex's schema, not a raw `/v1/models` response. It does not by itself fix desktop provider routing. `preferred_auth_method` and `disable_response_storage` are not needed by this recipe; do not add old tutorial settings without checking the current schema.

## Sources and next steps

- [Official desktop production update feed](https://persistent.oaistatic.com/codex-app-prod/appcast.xml)
- [Official authentication and alternative-provider documentation](https://developers.openai.com/codex/auth/)
- [Official configuration reference](https://developers.openai.com/codex/config-reference/)
- [Official advanced provider configuration](https://developers.openai.com/codex/config-advanced/)
- [Codex 0.153.4 release](https://github.com/openai/codex/releases/tag/rust-v0.153.4) and [the original forced-login restriction change](https://github.com/openai/codex/commit/d87f87e25b6711f0268cfd884fa28555c6c46093)
- [Create and manage BoxAI keys](/docs/console/api-keys) · [Usage logs](/docs/console/usage-logs) · [Model Hub](/pricing)
