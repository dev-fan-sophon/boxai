import { getSandbox } from "@cloudflare/sandbox";

import { verifySignature } from "./auth";
import type { Env } from "./env";
import { HttpError, badRequest, json, positiveInt, required, str } from "./http";

const MANIFEST_MARKER = "__BOXAI_MANIFEST__";
const WORKSPACE = "/workspace";
const ENTRYPOINT = "/opt/boxai/run_build.py";

/** A build script asks for a Chromium-rendered PDF by writing <name>.pdf.html. reportlab can
 *  produce a correct PDF but not a well-designed one, and a real browser can. */
const HTML_PDF_SUFFIX = ".pdf.html";
const MAX_HTML_SOURCE_BYTES = 4_000_000;

const MAX_CODE_BYTES = 200_000;
const MAX_FILES = 20;
const MAX_LOG_CHARS = 16_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_SLEEP_AFTER_SECONDS = 900;
const DEFAULT_ARTIFACT_BYTES = 20 * 1024 * 1024;

/** Relative, no traversal, no absolute paths — these become filenames inside the container. */
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,127}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/;

interface FileRef {
  path: string;
  r2Key: string;
}

interface BuildRequest {
  jobId: string;
  sandboxKey: string;
  code: string;
  instance: "basic" | "standard-2";
  sleepAfterSeconds: number;
  timeoutMs: number;
  maxArtifactBytes: number;
  /** R2 key prefix for the produced files. The backend picks it so artifacts land straight in
   *  the asset-library namespace and never have to be copied afterwards. */
  artifactPrefix: string;
  inputs: FileRef[];
  previous: FileRef[];
}

interface ManifestEntry {
  name: string;
  bytes: number;
  verified: boolean;
}

/** `readFile` with `encoding: "none"` resolves to a stream; the SDK types it as a union. */
interface StreamedFile {
  content: ReadableStream<Uint8Array>;
  size: number;
  mimeType: string;
}

export async function handleBuild(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  await verifySignature(request, env, raw);
  const build = parseBuildRequest(raw, env);

  const namespace = build.instance === "standard-2" ? env.SANDBOX_STANDARD : env.SANDBOX_BASIC;
  const sandbox = getSandbox(namespace, build.sandboxKey, {
    sleepAfter: `${build.sleepAfterSeconds}s`,
  });
  const session = await sandbox.createSession({
    id: build.jobId,
    cwd: WORKSPACE,
    commandTimeoutMs: build.timeoutMs,
  });

  const startedAt = Date.now();
  try {
    // The container may be a warm one from an earlier build in the same conversation, so the
    // workspace is rebuilt from scratch rather than trusted. Correctness never depends on what
    // survived; see docs/document-artifacts.md § 2.5.
    await session.exec(
      `rm -rf ${WORKSPACE}/in ${WORKSPACE}/out ${WORKSPACE}/build.py && mkdir -p ${WORKSPACE}/in/previous ${WORKSPACE}/out`,
    );

    for (const input of build.inputs) {
      await writeFromR2(env, session, `${WORKSPACE}/in/${input.path}`, input.r2Key);
    }
    for (const previous of build.previous) {
      await writeFromR2(env, session, `${WORKSPACE}/in/previous/${previous.path}`, previous.r2Key);
    }
    await session.writeFile(`${WORKSPACE}/build.py`, build.code);

    const result = await session.exec(`python3 ${ENTRYPOINT}`, { timeout: build.timeoutMs });
    const { manifest, stdout } = splitManifest(result.stdout ?? "");
    const durationMs = Date.now() - startedAt;

    if (result.exitCode !== 0 || !manifest) {
      return json({
        status: "failed",
        artifacts: [],
        exit_code: result.exitCode,
        duration_ms: durationMs,
        error: manifest?.error || "build script failed",
        logs: { stdout: truncate(stdout), stderr: truncate(result.stderr ?? "") },
      });
    }

    const { exported, error } = await exportArtifacts(env, session, build, manifest.artifacts);
    if (error) {
      // Reported as a build failure rather than a transport error, so the self-heal loop sees it
      // and can fall back to writing the PDF with reportlab.
      return json({
        status: "failed",
        artifacts: [],
        exit_code: 0,
        duration_ms: Date.now() - startedAt,
        error,
        logs: { stdout: truncate(stdout), stderr: truncate(`${result.stderr ?? ""}\n${error}`) },
      });
    }
    return json({
      status: "completed",
      artifacts: exported,
      exit_code: 0,
      duration_ms: Date.now() - startedAt,
      error: "",
      logs: { stdout: truncate(stdout), stderr: truncate(result.stderr ?? "") },
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // A timeout means the script is still burning CPU in there. Everything else that lands here
    // left the container in an unknown state. Either way the sandbox is not worth keeping warm.
    await sandbox.destroy().catch(() => undefined);
    return json({
      status: "failed",
      artifacts: [],
      exit_code: -1,
      duration_ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : "build failed",
      logs: { stdout: "", stderr: "" },
    });
  }
}

export async function handleDestroy(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  await verifySignature(request, env, raw);
  const body = parseObject(raw);
  const sandboxKey = requireMatch(body, "sandbox_key", SAFE_ID);
  const instance = str(body, "instance") === "standard-2" ? "standard-2" : "basic";

  const namespace = instance === "standard-2" ? env.SANDBOX_STANDARD : env.SANDBOX_BASIC;
  await getSandbox(namespace, sandboxKey).destroy();
  return json({ status: "destroyed" });
}

async function writeFromR2(
  env: Env,
  session: { writeFile: (path: string, content: ReadableStream<Uint8Array>) => Promise<unknown> },
  destination: string,
  key: string,
): Promise<void> {
  const object = await env.R2.get(key);
  if (!object) badRequest(`input object not found: ${key}`);
  await session.writeFile(destination, object.body);
}

interface ExportedArtifact {
  name: string;
  r2_key: string;
  bytes: number;
  mime: string;
  verified: boolean;
}

interface BuildSession {
  readFile(path: string, options: { encoding: "none" }): Promise<unknown>;
  readFile(path: string): Promise<unknown>;
}

async function exportArtifacts(
  env: Env,
  session: BuildSession,
  build: BuildRequest,
  entries: ManifestEntry[],
): Promise<{ exported: ExportedArtifact[]; error: string }> {
  if (entries.length > MAX_FILES) badRequest("build produced too many files");
  let total = 0;
  const exported: ExportedArtifact[] = [];
  for (const entry of entries) {
    // The build script is model-authored and the model reads user-supplied content, so a
    // filename is untrusted input on its way into an R2 key.
    if (!SAFE_PATH.test(entry.name) || entry.name.includes("..")) {
      badRequest(`artifact name is malformed: ${entry.name}`);
    }
    total += entry.bytes;
    if (entry.bytes > build.maxArtifactBytes || total > build.maxArtifactBytes) {
      badRequest(`artifacts exceed the ${build.maxArtifactBytes} byte limit`);
    }

    if (entry.name.endsWith(HTML_PDF_SUFFIX)) {
      if (entry.bytes > MAX_HTML_SOURCE_BYTES) {
        return { exported, error: `${entry.name} is too large to render` };
      }
      const source = (await session.readFile(`${WORKSPACE}/out/${entry.name}`)) as { content: string };
      const rendered = await renderHtmlToPdf(env, source.content);
      if (typeof rendered === "string") return { exported, error: rendered };
      const name = entry.name.slice(0, -".html".length);
      const key = `${build.artifactPrefix}/${name}`;
      await env.R2.put(key, rendered, { httpMetadata: { contentType: "application/pdf" } });
      exported.push({
        name,
        r2_key: key,
        bytes: rendered.byteLength,
        mime: "application/pdf",
        verified: true,
      });
      continue;
    }

    const file = (await session.readFile(`${WORKSPACE}/out/${entry.name}`, {
      encoding: "none",
    })) as StreamedFile;
    const key = `${build.artifactPrefix}/${entry.name}`;
    await env.R2.put(key, file.content.pipeThrough(new FixedLengthStream(file.size)), {
      httpMetadata: { contentType: file.mimeType },
    });
    exported.push({
      name: entry.name,
      r2_key: key,
      bytes: entry.bytes,
      mime: file.mimeType,
      verified: entry.verified,
    });
  }
  return { exported, error: "" };
}

/** Returns the PDF bytes, or a message explaining why there are none. */
async function renderHtmlToPdf(env: Env, html: string): Promise<ArrayBuffer | string> {
  let response: Response;
  try {
    response = await env.BROWSER.quickAction("pdf", {
      html,
      pdfOptions: {
        format: "a4",
        printBackground: true,
        margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
      },
    });
  } catch (err) {
    return `Chromium PDF rendering is unavailable (${err instanceof Error ? err.message : "unknown error"}); write the PDF with reportlab instead.`;
  }
  if (!response.ok) {
    return `Chromium PDF rendering failed with status ${response.status}; write the PDF with reportlab instead.`;
  }
  const bytes = await response.arrayBuffer();
  // Browser Run answers errors as JSON with a 200 in some failure modes, so the signature is
  // checked rather than the status alone.
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  if (header !== "%PDF-") {
    return "Chromium returned something that is not a PDF; write the PDF with reportlab instead.";
  }
  return bytes;
}

/**
 * The entrypoint prints a manifest as its final stdout line. Everything above it is build output
 * the user sees, so the marker is stripped rather than passed through.
 */
function splitManifest(stdout: string): { manifest: { artifacts: ManifestEntry[]; error: string } | null; stdout: string } {
  const index = stdout.lastIndexOf(MANIFEST_MARKER);
  if (index < 0) return { manifest: null, stdout };
  const payload = stdout.slice(index + MANIFEST_MARKER.length).trim();
  try {
    const parsed = JSON.parse(payload) as { artifacts?: unknown; error?: unknown };
    const artifacts = Array.isArray(parsed.artifacts) ? (parsed.artifacts as ManifestEntry[]) : [];
    return {
      manifest: { artifacts, error: typeof parsed.error === "string" ? parsed.error : "" },
      stdout: stdout.slice(0, index).trimEnd(),
    };
  } catch {
    return { manifest: null, stdout };
  }
}

function truncate(value: string): string {
  return value.length <= MAX_LOG_CHARS ? value : `${value.slice(0, MAX_LOG_CHARS)}\n… truncated`;
}

function parseObject(raw: string): Record<string, unknown> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    badRequest("body must be JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) badRequest("body must be a JSON object");
  return body as Record<string, unknown>;
}

function requireMatch(body: Record<string, unknown>, key: string, pattern: RegExp): string {
  const value = required(body, key);
  if (!pattern.test(value)) badRequest(`${key} is malformed`);
  return value;
}

function parseBuildRequest(raw: string, env: Env): BuildRequest {
  const body = parseObject(raw);
  const code = str(body, "code");
  if (!code) badRequest("code is required");
  if (code.length > MAX_CODE_BYTES) badRequest("code is too large");

  const jobId = requireMatch(body, "job_id", SAFE_ID);
  let prefix = str(body, "artifact_prefix");
  if (prefix) {
    if (!SAFE_PATH.test(prefix) || prefix.includes("..")) badRequest("artifact_prefix is malformed");
  } else {
    prefix = `${env.ARTIFACT_PREFIX}/${jobId}`;
  }

  return {
    jobId,
    sandboxKey: requireMatch(body, "sandbox_key", SAFE_ID),
    code,
    instance: str(body, "instance") === "standard-2" ? "standard-2" : "basic",
    sleepAfterSeconds: positiveInt(body, "sleep_after_sec", 120, MAX_SLEEP_AFTER_SECONDS),
    timeoutMs: positiveInt(body, "timeout_ms", 120_000, MAX_TIMEOUT_MS),
    maxArtifactBytes: positiveInt(body, "max_artifact_bytes", DEFAULT_ARTIFACT_BYTES, DEFAULT_ARTIFACT_BYTES),
    artifactPrefix: prefix,
    inputs: parseFileRefs(body, "inputs"),
    previous: parseFileRefs(body, "previous"),
  };
}

function parseFileRefs(body: Record<string, unknown>, key: string): FileRef[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) badRequest(`${key} must be an array`);
  if (value.length > MAX_FILES) badRequest(`${key} holds too many entries`);
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") badRequest(`${key} entries must be objects`);
    const record = entry as Record<string, unknown>;
    const path = requireMatch(record, "path", SAFE_PATH);
    if (path.includes("..")) badRequest(`${key} path may not traverse`);
    return { path, r2Key: required(record, "r2_key") };
  });
}
