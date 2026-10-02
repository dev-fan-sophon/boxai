# BoxAI Desktop

BoxAI Desktop is the BoxAI-account desktop agent, based on
[pi-desktop](https://github.com/vastsa/pi-desktop). It replaces the former
OpenWorker client; that client's configuration, connector services and update
format do not apply. BoxAI Connect is a separate, unchanged product.

- [Download](https://you-box.com/agents)
- [User guides (English and Vietnamese)](https://you-box.com/docs/clients/desktop)
- [Integration and documentation ownership](../docs/desktop-integration.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [License](LICENSE)

## Develop

Run from `desktop/`. Use Node >= 22.19, the pnpm version pinned by
`package.json`, and a Rust toolchain compatible with `Cargo.toml`.
Packaged users do not need development toolchains. Native builds need their
platform's compiler and SDK; cross-compilation is not native release validation.

```bash
pnpm install --frozen-lockfile
pnpm build:js
pnpm build:host
pnpm dev
```

## Architecture

```text
React renderer → Preload IPC → Electron main
                                 ├─ Rust host-core: SQLite, tools, permissions
                                 └─ Node agent runtime: agent loop and model calls
```

| Directory | Responsibility |
| --- | --- |
| `apps/desktop/src` | React UI, local interaction state and i18n consumers |
| `apps/desktop/electron` | Desktop integration, preload and process orchestration |
| `crates/host-core` | Persistence, authoritative host state and tool admission |
| `packages/agent-runtime`, `agent-host`, `host-runtime` | Agent execution and lifecycle |
| `packages/shared`, `racp` | Cross-process contracts and transport |
| `packages/plugin-sdk`, `plugin-devkit` | Extension interfaces and author tooling |
| `packages/i18n` | Desktop UI translations |
| `examples/plugins` | Working extension examples |
| `scripts` | Build, checks and isolated integration tests |

Internal `@pi-desktop/*` names and protocol identifiers may remain for
compatibility. They are not an invitation to configure upstream model providers:
BoxAI Desktop model access uses the BoxAI gateway and the signed-in account.

## Validate

Choose checks for the changed boundary:

```bash
pnpm --filter @pi-desktop/desktop typecheck
pnpm lint
pnpm -r --if-present test
cargo fmt --check
cargo test -p host-core --locked
```

Use isolated profiles for integration tests. Do not spend real account balance
or use a person's projects as fixtures. See [scripts](scripts/README.md).
Release commands and publication are maintained in the repository's client
release tooling; do not run retained upstream GitHub release workflows as the
BoxAI publication path.

## Documentation

Public documentation has one source:
`web/default/content/docs/{en,vi}/clients/desktop*.md` and `desktop/*.md` in that
same content tree. Run the website's `bun run docs:validate` to generate search,
navigation, manifest and llms assets. The upstream VitePress site is not shipped
or maintained here. Consult upstream history for historical design context;
current source, schemas and tests determine behavior.
