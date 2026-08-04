# BoxAI

Unified AI API gateway at [you-box.com](https://you-box.com).

BoxAI aggregates OpenAI, Claude, Gemini, and 40+ upstream providers behind one API — keys, billing, rate limits, model catalog, and admin in one place.

## Target markets

| Priority | Market |
|----------|--------|
| **Primary** | **Vietnam** |
| **Secondary** | Other overseas markets |

Product decisions (payments, login, SMS, copy, compliance) should default to Vietnam-first, with English and other regions as secondary — not China-domestic assumptions.

## Stack (short)

- Backend: Go + Gin + GORM (SQLite / MySQL / PostgreSQL)
- Frontend: React 19 + TypeScript + Rsbuild (`web/default/`, Bun)
- Deploy: host binary + systemd; Docker only for Postgres/Redis — see [`deploy/README.md`](deploy/README.md)

## Docs for contributors / agents

- Project conventions: [`AGENTS.md`](AGENTS.md)
- Environment map: [`docs/environment.md`](docs/environment.md)
- Frontend rules: [`web/default/AGENTS.md`](web/default/AGENTS.md)
- **Public product docs system** (in-app `/docs`): [`docs/product-docs-system.md`](docs/product-docs-system.md)
- Public site docs: [you-box.com/docs](https://you-box.com/docs)
