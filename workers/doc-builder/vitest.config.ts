import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// These tests cover request authentication and validation, which is everything that happens
// before a container is involved. The container paths (a real build, and the assertion that
// egress is refused) need Docker and live in scripts/integration.mjs instead.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          SERVICE_SECRET: "test-secret",
          SANDBOX_TRANSPORT: "rpc",
          ARTIFACT_PREFIX: "doc-builds",
        },
        r2Buckets: ["R2"],
      },
    }),
  ],
});
