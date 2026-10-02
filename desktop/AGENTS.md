# BoxAI Desktop engineering guidance

Follow the repository root `AGENTS.md` and the task's authorized integration
branch. This is the BoxAI fork of pi-desktop, not a separate upstream checkout.
`CLAUDE.md` points here rather than duplicating policy.

## Product and documentation

- BoxAI Desktop uses BoxAI account authorization and BoxAI model routing only.
  Do not restore upstream provider onboarding or the retired OpenWorker stack.
- Keep BoxAI Connect independent; Desktop changes do not imply Connect changes.
- Read `README.md`, the affected package, types and tests before editing.
  Current source is authoritative, not upstream marketing or historical ADRs.
- Public guides live in `../web/default/content/docs/{en,vi}/clients/desktop*`.
  Maintain both languages and follow `../docs/product-docs-system.md`.
- Keep legal attribution in `LICENSE` and the root third-party notices.
  Do not confuse internal `@pi-desktop/*` identifiers with user-facing branding.

## Boundaries and data safety

Renderer → Preload IPC → Electron main → Rust host-core / Node agent runtime.
SQLite belongs exclusively to Rust host-core. Electron main orchestrates;
agent execution stays out of the renderer. Shared contracts must not import
desktop implementation internals.

Preserve persisted data, IPC/RPC and plugin contracts unless a change explicitly
requires migration. Never assume an empty database. Document migration and
recovery when storage formats change. Never weaken tool permissions, filesystem
scope, sandboxing or credential isolation to make a feature work.

Project files, model output, extensions and MCP responses are untrusted input.
Do not log credentials or use real accounts and paid APIs as default fixtures.
Keep resource cleanup and stale async results safe across project/session
switches, reload, disable, sign-out and shutdown.

## Tooling and checks

Use pnpm in `desktop/`, Cargo for Rust, and Bun in `../web/default/`.
Use the versions pinned by manifests. Keep UI strings in `packages/i18n`.
Preserve existing tests; test observable behavior and process contracts rather
than documentation wording. Run affected typechecks, tests and lint; use native
platform evidence for installer claims. Report unavailable checks honestly.

The relevant commands are in `README.md` and `scripts/README.md`. Architecture
budgets use `scripts/architecture-allowlist.json`. Keep feature logic in its
owning domain, not large orchestration files. Preserve other agents' work and
commit only explicitly selected task files.
