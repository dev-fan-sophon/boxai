# Upstream

BoxAI Desktop is a fork of [PI-Desktop](https://github.com/vastsa/pi-desktop)
(GNU LGPL-3.0, see `LICENSE`).

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/vastsa/pi-desktop |
| Imported commit | `3f8c02c63e6ca6ed9ff0c9c570cfc4aeadea92cd` (v0.21.0 line) |
| Import date | 2026-11-02 |
| Previous baseline | `503183fbca42e009de8cbadde7c366d2d8cc9656` (v0.16.0 line) |

The sync incorporates the upstream application, runtime, host, shared contracts,
plugins and localization changes. BoxAI's application version remains independent
of upstream package versions; this source sync does not publish an installer.

BoxAI-specific differences retained during synchronization:

- BoxAI website authorization, account gate and gateway-only model routing.
  Upstream vendor OAuth onboarding and direct Jev credentials remain unavailable.
- Profile-scoped data and secrets, BoxAI remote-host directories, official BoxAI
  skills/MCP catalogs, copy-only skill imports and custom plugin marketplaces.
  BoxAI account providers cannot be exported by remote-provider synchronization.
- BoxAI branding, Vietnamese/Japanese/Russian catalogs, signing configuration and
  `dl.you-box.com` update delivery. Internal `@pi-desktop/*`, RPC and storage
  format identifiers remain compatible with upstream.
- BoxAI documentation and release scripts remain authoritative. Upstream's
  documentation site, GitHub workflows and direct-provider-only acceptance tests
  are not imported as BoxAI product/release policy.

Storage now uses the upstream S3-based encrypted configuration sync rather than
the former WebDAV transport. Existing local profiles remain in place. Configure
an S3-compatible destination explicitly; do not treat WebDAV credentials as S3
credentials. Keep a local backup before upgrading or moving configuration data.

## Validation caveat for this baseline

Two unchanged upstream Rust integrity tests fail on the Linux orb:
`same_size_rewrite_restoring_mtime_cannot_reuse_a_verified_generation` and
`invalid_encoded_revision_blocks_stored_and_live_revision_appends`.
`transcripts/binary_integrity.rs` caches file identity, size, mtime and ctime;
consecutive same-size writes can share those timestamps on this filesystem,
allowing an externally corrupted transcript to reuse a cached proof. The failing
assertions remain intact. This is an unresolved upstream integrity issue, not a
passing check or a verified installer release. Windows/macOS native release
validation is still required before distributing this baseline.

The previous OpenWorker-based BoxAI Desktop was removed in the original v0.16.0
import. Its source remains available in git history before that import.

All BoxAI modifications are published in this public repository, satisfying
the LGPL-3.0 source availability requirement. Keep `LICENSE` intact.
