# Docs screenshots (P1)

Automated UI captures for product docs figures.

## Layout

```
scripts/docs/screenshots/
  README.md                 # this file
  scenarios/                # Playwright scenario stubs (add when CI is ready)
public/docs/screenshots/
  start/
  console/
  api/
  clients/
  playground/
```

## Naming

`{area}/{action}.{locale}.webp` and optional widths:

- `console/api-keys-create.en.webp`
- `console/api-keys-create.en-960.webp`

## Rules

- Fake data only (no real keys, emails, balances).
- Prefer light theme; optional `*.dark.webp`.
- Prefer **overlay annotations** in `DocFigure` over baking arrows into PNGs.
- Keep alt text + caption in Markdown so AI/crawlers are not figure-only.

## Local (when Playwright is wired)

```bash
# planned
bun run docs:screenshots
```

Until then, export WebP manually into `public/docs/screenshots/` and reference
from MD:

```markdown
![Create API key](/docs/screenshots/console/api-keys-create.en.webp "1. Console → API Keys → Create")
```
