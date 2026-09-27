# Upstream lineage

BoxAI Connect 2 adapts **yetone/magpie** at the exact revision
`03a01a548df3d52fee86197fc2d0ff234b9fdfab`, under the MIT license preserved
verbatim in [`LICENSE.magpie`](LICENSE.magpie). The module path remains an
internal source compatibility detail, not a product name or update origin.

BoxAI maintains product identity, BoxAI integration, GUI branding, release
metadata and packaging, and Ed25519 installer verification. Upstream Magpie
release feeds, unsigned hash-only updates and binary self-replacement are not
BoxAI distribution paths.

Retained release/catalog/connector-derived code has Apache-2.0 lineage from
OriginGame bkit and GatewayConnector. [`LICENSE`](LICENSE) and the repository
NOTICE remain applicable to that derived code; importing MIT code does not
relicense it. Historical pins:

| Component | Repository | Revision |
| --- | --- | --- |
| OriginGame bkit | `fran0220/origingame` | `c9d03dbfb9dbc16fe4f16a0bdd649a49cb66946b` |
| Public GatewayConnector | `fran0220/GatewayConnector` | `bdc03cad32c6cfc96993c177831cb8d124f1aa2f` |
| Historical GPUI Box | `fran0220/gpui-box` | `7636d2e4a4b26b7981843dc59f04153f7a51f20d` |

GPUI/Cargo are no longer the Connect application build. Both license texts
must accompany native distributions.
