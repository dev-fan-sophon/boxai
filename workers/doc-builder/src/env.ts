import type { DocSandboxBasic, DocSandboxStandard } from "./sandbox";

export interface Env {
  // One binding per instance type. instance_type is fixed per container config in wrangler.toml,
  // so tier selection has to be a choice between namespaces rather than a per-request option.
  SANDBOX_BASIC: DurableObjectNamespace<DocSandboxBasic>;
  SANDBOX_STANDARD: DurableObjectNamespace<DocSandboxStandard>;

  R2: R2Bucket;

  BROWSER: BrowserRun;

  SANDBOX_TRANSPORT: string;
  ARTIFACT_PREFIX: string;

  // Shared with the Go backend. Absent means the worker refuses every build rather than
  // accepting unsigned requests.
  SERVICE_SECRET?: string;
}
