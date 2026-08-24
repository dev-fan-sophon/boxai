# Docs screenshots

Capture pipeline for product docs figures under `public/doc-assets/screenshots/`.

Static assets live under **`/doc-assets/*`** (not `/docs/*`) so the Gin static
file server does not shadow the SPA `/docs` product-docs routes.

## Commands

```bash
# Install browser once (CI/dev machine)
bunx playwright install chromium

# Capture live public + authenticated console pages
# Requires BOXAI_ADMIN_TOKEN + BOXAI_ADMIN_USER_ID for console shots
bun run docs:screenshots

# Optional base URL / model detail overrides
DOCS_SHOTS_BASE_URL=https://you-box.com \
DOCS_SHOTS_MODEL_ID=gemini-3.6-flash \
bun run docs:screenshots
```

## Output

```
public/doc-assets/screenshots/
  auth/sign-in.en.webp (+ -480 / -960 / -1536)
  console/api-keys-empty.en.webp
  console/api-keys-create.en.webp
  console/api-keys-created.en.webp
  console/model-hub.en.webp
  console/model-hub-detail.en.webp
  console/billing-topup.en.webp
  console/usage-logs.en.webp
  console/dashboard.en.webp
  playground/chat-success.en.webp
  start/docs-home.en.webp
  start/getting-started.en.webp
  clients/downloads.en.webp
  clients/desktop-session.en.webp   # reused from desktop marketing set
  capture-manifest.json
```

## Safety

- **Live shots** hit real product UI on `BASE_URL` (default `https://you-box.com`).
- **Console shots** authenticate with the management access token via request
  headers (`Authorization` + `New-Api-User`) and seed `localStorage` user/uid.
  They capture the real SPA — never HTML mock fixtures.
- Do not commit raw secrets into images. Prefer masked/revealed-on-hover UI
  already present in the product. Rotate any key accidentally exposed.
- Prefer overlay annotations in MD/`DocFigure` over baking arrows into images.

## Wiring into docs

Reference paths from Markdown:

```markdown
![API Keys list](/doc-assets/screenshots/console/api-keys-empty.en.webp '1. Open Console → API Keys')
```
