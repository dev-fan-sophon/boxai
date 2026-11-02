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

## BoxAI transcript-integrity fix

The imported timestamp-only integrity cache failed two upstream regression
tests on Linux: same-size transcript rewrites and corrupt stored/live revision
appends could reuse a proof when filesystem timestamps collided. BoxAI now
checks a streaming SHA-256 digest before reusing decoded-record validation.
Owned appends extend that digest from verified bytes and the bytes just written,
never from an unvalidated reread of the file. The original assertions remain
intact, with a deterministic metadata-collision regression for middle-of-file
corruption, unchanged history on refusal and recovery after repair.

This deliberately trades constant-time metadata checks for a linear read using
a bounded buffer. Unchanged history is not JSON/binary-decoded again; changed
content must pass the decoder before another write. Local data formats and
migrations are unchanged. Native installer acceptance remains separate from
source and unit-test validation, and does not authorize publication.

## Windows compatibility fixes

Relocation preserves normalized capability identity keys, so disabled project
capabilities stay disabled and colliding identities are rejected before the
state file is replaced. Skill scans use the same project spelling as their
ownership records, including when callers pass Windows verbatim paths. Remote
workspace permissions interpret the protocol's POSIX paths independently of
the local operating system; outside paths still require approval.

Native test fixtures compare paths by components where separator spelling is
not part of the contract. Worktree fixtures set LF behavior only in their own
temporary repositories. The background-task test yields while waiting for the
supervisor to stop the process tree; it no longer blocks the single-threaded
Tokio runtime. The process-snapshot watermark uses precise UTC time: the coarse
Windows clock can lag process creation times and incorrectly exclude a live
descendant as a recycled PID. Job termination order and PID-reuse checks remain
unchanged; no timestamp tolerance or delayed assertion is introduced.

The previous OpenWorker-based BoxAI Desktop was removed in the original v0.16.0
import. Its source remains available in git history before that import.

All BoxAI modifications are published in this public repository, satisfying
the LGPL-3.0 source availability requirement. Keep `LICENSE` intact.
