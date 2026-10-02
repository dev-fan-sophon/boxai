# Example Plugins

Sample plugins for development, specification, and integration tests. Start
with the types and validators in [the Plugin SDK](../../packages/plugin-sdk/src)
and compare the examples with current host tests before using them as API references.

## hello

Reference example covering:

- `commands`
- `ui.panel`
- `agentTools`
- `skills`
- `settings`
- `themes`
- resident `services`
- inter-plugin `bus`
- `permissions`

Panel chrome contract:

- BoxAI Desktop owns exactly a transparent 46px drag band and the minimal
  top-right three-button window-control capsule on every platform.
- Normal-flow panel content is offset below that band automatically. Do not
  add another 46px top padding.
- If a panel adds fixed or sticky top UI, anchor it at
  `top: var(--pi-plugin-titlebar-height, 46px)`. The plugin owns that UI and
  should add `-webkit-app-region: no-drag` to its interactive controls.

## ui-slots-lab

Test plugin for the renderer UI slots. It puts one
visible sample in every slot, each marked `data-lab="<slot>[:<side>]"`:

- `userAction` / `assistantAction` items; the assistant bar's right side has
  four items, so the fourth sits in the ⋯ menu
- two stacked `entryExtra` blocks under a reply
- the `toolCard` of its own `lab_probe` tool
- the `blockRenderer` for `lab.ui-slots:chart` fences (`label,value` lines)
- `composerControl` controls on both toolbar sides

The samples exercise the contract a person should see working: `plugin.call`
round trips (`Echo`, `Refuse` → `LAB_REFUSED`, `Stall` →
`PLUGIN_CALL_TIMEOUT`), `composer.insertText`, a `Crash` control the host
must contain, `Grow` past the entryExtra collapsed height, and deliberate
contract failures that hand the block back to the host: `lab_probe`
with `mode: "crash"`, and a chart whose first line is `crash` or `tall`
(taller than the 4000px clamp).

Covered by `apps/desktop/test/plugin-ui-slots-lab.test.mjs` and the Electron
E2E.

## Upstream marketplace reference

Upstream plugins live in [`vastsa/pi-desktop-plugins`](https://github.com/vastsa/pi-desktop-plugins).
This is a third-party source, not a BoxAI security endorsement.

Local examples here remain useful for development loading (`Load dev plugin`).
Use the catalog configured by the current app for Marketplace installs and review permissions.


## Practical template

An upstream template and contribution guide are available at:

- https://github.com/vastsa/pi-desktop-plugins/tree/main/plugins/demo.workspace-summary
- Contribution guide: https://github.com/vastsa/pi-desktop-plugins/blob/main/CONTRIBUTING.md
