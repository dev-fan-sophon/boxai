# Upstream lineage

BoxAI Connect vendors and adapts the GPUI bkit workspace from the private
OriginGame repository in order to preserve reproducible builds of the exact
design used for this release.

| Component | Repository | Revision |
| --- | --- | --- |
| OriginGame GPUI bkit source | `fran0220/origingame` | `c9d03dbfb9dbc16fe4f16a0bdd649a49cb66946b` |
| Public GatewayConnector lineage | `fran0220/GatewayConnector` | `bdc03cad32c6cfc96993c177831cb8d124f1aa2f` |
| GPUI Box dependency | `fran0220/gpui-box` | `7636d2e4a4b26b7981843dc59f04153f7a51f20d` |

The GPUI dependency upgrade was checked against OriginGame kit's coherent
`c76314347a6aab483231a2c8caf35f99e88b2294` pin and the later GPUI Box
RowSnapshot release. All six dependencies and the workspace-root `block`
compatibility patch share the exact revision above. The explicit Codex model
catalog regression fix is ported from OriginGame
`f685d67ca2ffb6af938a7b345bbcf808b9cd91b9`.

The vendored workspace remains licensed under Apache License 2.0; see
[`LICENSE`](LICENSE). BoxAI-specific identity, gateway integration, Vietnamese
localization, catalog content, distribution metadata, and release tooling are
maintained in this repository.
