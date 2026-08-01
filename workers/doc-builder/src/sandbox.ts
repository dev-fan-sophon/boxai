import { Sandbox } from "@cloudflare/sandbox";

import type { Env } from "./env";

/**
 * Egress is the only exfiltration channel available to model-authored code, and prompt injection
 * from an uploaded document is a realistic way to get hostile code into this container. Sandboxes
 * allow outbound traffic by default, so the flag below is the whole mitigation.
 *
 * Two rules follow from how the SDK implements it: `allowedHosts` must stay unset, because any
 * value there overrides `enableInternet` and re-opens the sandbox; and the flag is read when the
 * container starts, so a running sandbox keeps whatever policy it booted with.
 */
class NoEgressSandbox extends Sandbox<Env> {
  enableInternet = false;
}

/** Text documents and simple sheets: 1/4 vCPU, 1 GiB. */
export class DocSandboxBasic extends NoEgressSandbox {}

/** Data analysis, charts, large decks: 1 vCPU, 6 GiB. */
export class DocSandboxStandard extends NoEgressSandbox {}
