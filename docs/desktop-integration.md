# BoxAI Desktop integration

## Current ownership

BoxAI Desktop is the pi-desktop-based Electron/React application in `desktop/`.
It replaces the retired OpenWorker/Python/Tauri client. BoxAI Connect remains
the independent Go/Wails companion in `connect/`; do not migrate it as part of
Desktop work.

- User guides: `web/default/content/docs/{en,vi}/clients/desktop.md` and
  `clients/desktop/*.md`, published at `/docs/clients/desktop`.
- Download entry: `/agents`; release artifacts are delivered through
  `dl.you-box.com`. Do not pin guide links to a versioned installer.
- Engineering: `desktop/README.md`, `desktop/AGENTS.md` and executable tests.
- Account, credential and model invariants: [desktop-account.md](desktop-account.md).
- Website documentation pipeline: [product-docs-system.md](product-docs-system.md).
- Operational variables: [environment.md](environment.md).

## Architecture and account boundary

The renderer talks through preload IPC to Electron main. Rust host-core owns
SQLite and authoritative host/tool state; the Node agent runtime executes the
agent loop. BoxAI authorization and model access replace upstream provider
setup. All built-in model traffic uses the BoxAI gateway. Plugins and MCP are
separate capabilities and may contact their own services.

Do not describe the retired connector broker, Slack bot, Python service or
Tauri updater as dependencies of this client. No old-client history or
configuration migration is promised. Preserve old user data until the user
chooses what to retain; replacing application code is not permission to delete it.

## Documentation release gate

Before publishing a release, check the real account screen, authorization
callback, model filtering, permission labels, local data path, supported OS
versions, installer signing and update behavior against that release's source
and native evidence. Do not infer these from upstream screenshots.

Update both English and Vietnamese. Add every published route to
`common/seo.go`, `content/docs/meta.ts` and the builder's bilingual core list.
Run docs validation, focused docs tests, typecheck and build from `web/default`.
Inspect desktop and mobile guide navigation in both languages. The generator
owns sidebar entries, search, manifest and `llms.txt`.

## Screenshot handoff

Reserve these stable paths under `web/default/public/desktop-screenshots/docs/`:

| File | Required state |
| --- | --- |
| `login.webp` | Actual BoxAI sign-in entry; no real account details |
| `models.webp` | BoxAI model picker with one selected model |
| `project-session.webp` | Disposable project and short successful session |
| `permissions.webp` | Ask-mode request with Allow once, Allow for this chat and Deny |
| `settings.webp` | Real skills/MCP/settings surface |
| `updates.webp` | Actual update check/result state |

Guide source comments reserve positions until captures exist; do not publish
broken image URLs or reuse retired-client screenshots. Capture English UI with
Vietnamese explanatory text; add separate locale variants only when needed.
Use real rendered output, fictional safe project content and no credentials.
Concept art must be labelled as illustration, never as a product screenshot.
Demonstration videos supplement, rather than replace, written steps.

## Removed and retained documentation

The old OpenWorker integration proposal has been replaced by this document.
The upstream VitePress site, duplicated Chinese README and upstream policy
mirrors/checkers are removed. Maintainer instructions are consolidated in
`desktop/README.md`; public how-to content belongs only in the product docs.
Architecture-budget data remains in `desktop/scripts/architecture-allowlist.json`.
Historical ADR references in source comments identify upstream history, not
active BoxAI documentation. Licensing files remain intact.

The old connector broker source is removed independently of deployed services.
Removing source or docs does not decommission deployed Workers, revoke OAuth apps, delete
D1 data or authorize production changes.
