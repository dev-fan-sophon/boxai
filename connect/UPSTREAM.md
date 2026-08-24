# Upstream lineage

BoxAI Connect vendors and adapts the GPUI bkit workspace from the private
OriginGame repository in order to preserve reproducible builds of the exact
design used for this release.

| Component | Repository | Revision |
| --- | --- | --- |
| OriginGame GPUI bkit source | `fran0220/origingame` | `c9d03dbfb9dbc16fe4f16a0bdd649a49cb66946b` |
| Public GatewayConnector lineage | `fran0220/GatewayConnector` | `bdc03cad32c6cfc96993c177831cb8d124f1aa2f` |
| GPUI Box dependency | `fran0220/gpui-box` | `1e5bb24995d7531e32f7dec1658e0cd49db472ff` |

The vendored workspace remains licensed under Apache License 2.0; see
[`LICENSE`](LICENSE). BoxAI-specific identity, gateway integration, Vietnamese
localization, catalog content, distribution metadata, and release tooling are
maintained in this repository.
