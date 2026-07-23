# Playground P1–P3 Backend & Frontend

This document lists the APIs, environment variables, and **models/providers to configure** after deploying the P1–P3 playground workbench.

## API list

### Relay (`UserAuth` + channel distribute)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/pg/chat/completions` | Chat |
| POST | `/pg/responses` | Managed Grok native web/X search; requires run ID and execution token headers |
| POST | `/pg/images/generations` | Image gen; accepts `images` / `image` reference fields |
| POST | `/pg/images/edits` | Image edits (same body as OpenAI image edits + playground `group`) |
| POST | `/pg/audio/speech` | TTS |
| POST | `/pg/video/generations` | Video task; `first_frame`, `last_frame`, `input_reference`, `images[]` |

### Data APIs (`UserAuth` unless noted)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/playground/estimate` | Pricing estimate from site ratios |
| POST | `/api/playground/chat/multi` | Multi-model fan-out + summary |
| GET/POST | `/api/playground/assets` | List / multipart upload |
| GET | `/api/playground/assets/:id/content` | Owner-only binary |
| DELETE | `/api/playground/assets/:id` | Owner-only delete |
| POST | `/api/playground/upload-sessions` | QR/cross-device session |
| GET | `/api/playground/upload-sessions/:token` | Session status |
| POST | `/api/playground/upload-sessions/:token/file` | **No user auth** — token binds owner |
| GET/POST | `/api/playground/conversations` | Cloud chat list / create |
| GET/PATCH/DELETE | `/api/playground/conversations/:id` | |
| PUT | `/api/playground/conversations/:id/messages` | Replace message snapshot |
| GET/POST | `/api/playground/personas` | Role prompts |
| PATCH/DELETE | `/api/playground/personas/:id` | |
| GET | `/api/playground/tasks` | Aggregate tasks + runs |
| POST | `/api/playground/runs` | Record “My works” run |
| GET/POST | `/api/playground/voices` | Voice clone records (pending_provider without upstream) |
| DELETE | `/api/playground/voices/:id` | |
| GET | `/api/playground/skill` | SKILL.md (auth) |
| GET | `/api/playground/skill.md` | SKILL.md download (public) |
| GET | `/api/playground/inspiration/categories` | Public seed data |
| GET | `/api/playground/inspiration/templates` | Public seed data |
| POST | `/api/playground/inspiration/templates/:id/use` | Use counter |

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAYGROUND_ASSETS_DIR` | `data/playground-assets` | Local filesystem root for uploads |
| `PLAYGROUND_INTERNAL_BASE` | `http://127.0.0.1:$PORT` | Base URL for multi-chat internal fan-out |
| `SERVER_ADDRESS` | _(empty)_ | Base URL printed in SKILL.md |
| `PORT` | `3000` | Used for internal multi-chat base when `PLAYGROUND_INTERNAL_BASE` unset |

## Upload limits

| Kind | Max size | MIME allowlist (examples) |
|------|----------|---------------------------|
| image | 10 MB | jpeg, png, webp, gif |
| video | 50 MB | mp4, webm, quicktime |
| audio | 20 MB | mpeg, wav, webm, ogg, m4a |

## Database tables (AutoMigrate)

- `playground_assets`
- `playground_conversations` / `playground_messages`
- `playground_personas`
- `playground_runs`
- `playground_voices`
- `playground_upload_sessions`
- `inspiration_categories` / `inspiration_templates` (seeded when empty)

## MODELS / PROVIDERS TO CONFIGURE

Fill these in admin **Channels** + **Model pricing** before users can generate for real. The platform API and UI are wired; without upstream channels the relay returns the usual “no available channel” errors.

### Chat

- [ ] At least one OpenAI-compatible chat channel (GPT / Claude / Gemini / etc.)
- [ ] Model price **or** model ratio for each chat model exposed in playground catalog
- [ ] Group ratios for user groups used in the workbench

### Image

- [ ] Image generation models (e.g. `dall-e-3`, `gpt-image-1`, Flux, vendor i2i models)
- [ ] Image **edit** models if using reference / edit mode (`/pg/images/edits`)
- [ ] Confirm channel supports `images` / multipart edits for reference media

### Video

- [ ] Video task platform channel (Kling, Ali Wan, Sora, Doubao, Hailuo, Jimeng, …)
- [ ] Model mapping for i2v / first-last frame where applicable
- [ ] Task polling enabled (`TaskEnabled`)

### Audio / TTS

- [ ] Speech model channel (`tts-1`, CosyVoice, etc.)
- [ ] Optional: voice-clone **provider** integration — until then `/api/playground/voices` stores assets as `pending_provider`

### Web search

- [ ] Enable a Grok 4 search-capable model in each intended user group
- [ ] The managed search route uses native `web_search` and `x_search` Responses tools

### Multi-model collaboration

- [ ] Ensure `PLAYGROUND_INTERNAL_BASE` (or loopback port) reaches this process with the same session cookies
- [ ] Multiple chat models available to the user group
- [ ] Partial failures: failed legs are reported; summary runs if ≥1 leg succeeds

### Voice clone (stub)

- [ ] Choose provider (OpenAI voice clone, Azure custom neural, Minimax, etc.)
- [ ] Map `playground_voices.provider_voice_id` when ready
- [ ] Wire speech path to accept custom voice IDs

## Frontend wiring

- Media slots: `attachable={true}`; reference passed as data URL or asset content URL
- Image with reference → `/pg/images/edits` when edit mode
- Video with reference → `first_frame` / `input_reference`
- Price hint debounces `POST /api/playground/estimate`
- Asset library + upload session polling
- Cloud conversations / personas when authenticated
- Duo workspace calls `POST /api/playground/chat/multi`
- Inspiration loads API templates with static fallback
- Agents skill dialog downloads `/api/playground/skill.md`

## Intentional gaps / follow-ups

1. **QR upload UX**: session token + poll is implemented; a full phone QR landing page UI is minimal (upload URL shown in toast).
2. **Voice clone upstream**: records stay `pending_provider` until a provider is configured.
3. **Multi-chat** depends on loopback HTTP to self; reverse-proxy only deployments should set `PLAYGROUND_INTERNAL_BASE`.
4. **PPT / infinite canvas agents**: still documented as coming soon (modality jumps work).
