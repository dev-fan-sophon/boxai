# Docs screenshots

Capture pipeline for product docs figures under `public/docs/screenshots/`.

## Commands

```bash
# Install browser once (CI/dev machine)
bunx playwright install chromium

# Capture live public pages + sanitized console fixtures
bun run docs:screenshots

# Optional base URL override
DOCS_SHOTS_BASE_URL=https://you-box.com bun run docs:screenshots
```

## Output

```
public/docs/screenshots/
  auth/sign-in.en.webp (+ -480 / -960 / -1536)
  console/api-keys-empty.en.webp
  console/api-keys-create.en.webp
  console/api-keys-created.en.webp
  console/model-hub.en.webp
  console/model-hub-detail.en.webp
  console/billing-topup.en.webp
  console/usage-logs.en.webp
  playground/chat-success.en.webp
  start/docs-home.en.webp
  start/getting-started.en.webp
  clients/downloads.en.webp
  clients/desktop-session.en.webp   # reused from desktop marketing set
  capture-manifest.json
```

## Safety

- **Live shots** only hit public routes (sign-in, pricing, docs, downloads).
- **Console shots** use local HTML fixtures with fake keys (`sk-boxai-••••`), fake
  balances, and demo model IDs — never production secrets.
- Prefer overlay annotations in MD/`DocFigure` over baking arrows into images.

## Wiring into docs

Reference paths from Markdown:

```markdown
![API Keys empty state](/docs/screenshots/console/api-keys-empty.en.webp "1. Open Console → API Keys")
```
