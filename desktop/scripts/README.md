# Desktop scripts

Run these from `desktop/` with the pnpm version pinned in `package.json`.
The root BoxAI workflows own publication; nested upstream workflows are not
automatically active in this monorepo.

| Task | Command |
| --- | --- |
| Development app | `pnpm dev` |
| JS packages | `pnpm build:js` |
| Rust host | `pnpm build:host` |
| Desktop types | `pnpm --filter @pi-desktop/desktop typecheck` |
| Package tests | `pnpm -r --if-present test` |
| Rust tests | `cargo test -p host-core --locked` |
| Boot integration | `pnpm test:e2e:boot` |
| Plan integration | `pnpm test:e2e:plan` |
| Permission admission | `node scripts/e2e-tool-admission.mjs` |
| Architecture budgets | `node scripts/check-architecture.mjs` |

Other `test:e2e:*` aliases in `package.json` select specific boundaries. Read
their fixture and environment requirements before running them. Use isolated
profiles; live-provider scripts require explicit authorization and may incur
charges. A passed unit test does not validate a native installer.

`architecture-allowlist.json` preserves the existing architecture-budget
exceptions after removal of the upstream docs site. Keep reasons attached to
the affected modules rather than disabling the guard.

Public docs use `bun run docs:validate` in `../../web/default`, not a separate
VitePress build. Screenshot files and capture expectations are described in
`../../docs/desktop-integration.md`.
