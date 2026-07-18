# BoxAI Management API Reference

Base URL: `$BOXAI_BASE_URL`. Authenticated `/api/*` requests require the management bearer token and matching `New-Api-User` ID.

## Roles

| Role | Value | Scope |
|---|---:|---|
| User | 1 | Own account, gateway tokens, usage |
| Admin | 10 | Users, channels subject to assigned permissions, models, subscriptions, redemptions, logs |
| Root | 100 | All Admin functions plus global options, administrator permissions, OAuth providers and system operations |

Only Root can promote a user to Admin or change an Admin's permission map. The API does not create or promote another Root account.

## Users and administrators

| Method | Path | Minimum role | Purpose |
|---|---|---:|---|
| GET | `/api/user/` | Admin | List users |
| GET | `/api/user/search?keyword=...` | Admin | Search users |
| GET | `/api/user/:id` | Admin | Read manageable user |
| POST | `/api/user/` | Admin | Create a lower-role user |
| PUT | `/api/user/` | Admin | Update a manageable user |
| POST | `/api/user/manage` | Admin | Status, role and quota actions |
| DELETE | `/api/user/:id` | Admin | Permanently delete lower-role user |
| DELETE | `/api/user/:id/2fa` | Admin | Disable user's 2FA |

Manage payloads:

```json
{"id":42,"action":"disable"}
{"id":42,"action":"enable"}
{"id":42,"action":"promote"}
{"id":42,"action":"demote"}
{"id":42,"action":"add_quota","mode":"add","value":500000}
{"id":42,"action":"add_quota","mode":"subtract","value":500000}
{"id":42,"action":"add_quota","mode":"override","value":500000}
```

`promote` requires Root. Never infer quota units; inspect current UI/controller semantics before changing quota.

## Global options

| Method | Path | Role | Purpose |
|---|---|---:|---|
| GET | `/api/option/` | Root | Read non-sensitive runtime options |
| PUT | `/api/option/` | Root | Update one option |
| POST | `/api/option/rest_model_ratio` | Root | Reset model ratios |
| POST | `/api/option/payment_compliance` | Root | Confirm payment compliance |

Update payload:

```json
{"key":"SystemName","value":"BoxAI"}
```

The GET endpoint omits option names ending in `Token`, `Secret`, `Key`, `secret`, or `api_key`. Never treat an omitted secret as empty and overwrite it accidentally.

## Channels

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/channel/` | ChannelRead | List channels |
| GET | `/api/channel/:id` | ChannelRead | Read channel metadata |
| POST | `/api/channel/` | ChannelSensitiveWrite | Create channel |
| PUT | `/api/channel/` | ChannelWrite | Update channel |
| POST | `/api/channel/:id/status` | ChannelOperate | Change status |
| GET | `/api/channel/test/:id` | ChannelOperate | Test channel |
| GET | `/api/channel/fetch_models/:id` | ChannelOperate | Fetch upstream models |
| DELETE | `/api/channel/:id` | ChannelSensitiveWrite | Delete channel |
| POST | `/api/channel/:id/key` | Root + verification | Reveal channel credential |

Inspect `controller/channel.go` request structs before creating or updating a channel; payload fields vary by provider.

## Other management groups

| Prefix | Role | Purpose |
|---|---:|---|
| `/api/models` | Admin | Model metadata and upstream sync |
| `/api/vendors` | Admin | Vendor metadata |
| `/api/group` | Admin | Available groups |
| `/api/prefill_group` | Admin | Prefill groups |
| `/api/subscription/admin` | Admin | Plans and user subscriptions |
| `/api/redemption` | Admin | Redemption codes |
| `/api/log` | Admin read, Root delete | Usage and audit logs |
| `/api/data` | Admin | Quota/flow reporting |
| `/api/custom-oauth-provider` | Root | Custom OAuth providers |
| `/api/performance` | Root | Runtime statistics and maintenance |
| `/api/system-task` | Root | Asynchronous system tasks |
| `/api/system-info` | Root | Instance management |

## Response handling

Many handlers return HTTP 200 even when the body indicates failure. Always check:

```json
{"success":false,"message":"..."}
```

Do not rely on HTTP status alone. Read a resource back after a successful mutation when possible.
