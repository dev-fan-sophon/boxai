// Explicitly fake UI fixtures, never embedded in the application. No real
// authentication, agent files or upstream requests. Run: bun testdata/preview.mjs
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const assets = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
let session = {
  authenticated: false,
  pending: false,
  account: { display_name: "Minh Nguyen" },
};
let failNext = false;
const requests = [];
let settings = {
  lang: "en",
  theme: "light",
  tray: "panel",
  proxy: "direct",
  version: "2.0.0 (UI fixture)",
  dir: "~/.config/boxai-connect",
  redact: true,
};
const options = [
  { value: "boxai/gpt-5", label: "GPT-5", ref: "boxai/gpt-5" },
  {
    value: "boxai/claude-sonnet-4",
    label: "Claude Sonnet 4",
    ref: "boxai/claude-sonnet-4",
  },
  {
    value: "boxai/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    ref: "boxai/gemini-2.5-pro",
  },
];
const state = {
  agents: [
    {
      id: "claude",
      name: "Claude Code",
      path: "~/.claude/settings.json",
      fields: [
        { key: "model", label: "Model", value: options[1].value, options },
      ],
    },
    {
      id: "codex",
      name: "Codex CLI",
      path: "~/.codex/config.toml",
      fields: [
        { key: "model", label: "Model", value: options[0].value, options },
        {
          key: "effort",
          label: "Reasoning effort",
          value: "high",
          options: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ],
        },
      ],
    },
  ],
  settings,
};
const library = {
  agents: state.agents.map((a) => ({
    id: a.id,
    name: a.name,
    mcp: a.path,
    skills: a.path,
    instructions: a.path,
  })),
  servers: [
    {
      name: "boxai-media",
      transport: "http",
      url: "https://you-box.com/mcp",
      agents: ["claude"],
    },
  ],
  skills: [
    {
      name: "boxai-tools",
      description: "BoxAI",
      kind: "folder",
      agents: ["codex"],
    },
  ],
  instructions: { shared: "", agents: [] },
};
const json = (data, status = 200) => Response.json(data, { status });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4178,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/__fixture" && request.method === "POST") {
      const patch = await request.json();
      session = { ...session, ...patch };
      failNext = patch.failNext || false;
      requests.length = 0;
      return json(session);
    }
    if (path === "/__requests") return json(requests);
    if (path === "/boot.js")
      return new Response(
        'window.bootPrefs = {lang:"en",theme:"light",uiToken:"fixture-only-token"}',
        {
          headers: { "Content-Type": "text/javascript" },
        },
      );
    if (!path.startsWith("/api/")) {
      const allowed = [
        "/",
        "/index.html",
        "/connect.js",
        "/connect.css",
        "/connect-i18n.js",
        "/boxai.png",
      ];
      if (!allowed.includes(path))
        return new Response("Not found", { status: 404 });
      return new Response(
        Bun.file(resolve(assets, path === "/" ? "index.html" : path.slice(1))),
      );
    }
    requests.push({
      path,
      method: request.method,
      uiToken: request.headers.get("X-BoxAI-UI-Token"),
    });
    if (
      request.method === "POST" &&
      request.headers.get("X-BoxAI-UI-Token") !== "fixture-only-token"
    )
      return json({ error: "fixture UI token missing" }, 403);
    if (path === "/api/boxai/session") return json(session);
    if (path === "/api/boxai/login") {
      session.pending = true;
      return json(session, 202);
    }
    if (path === "/api/boxai/cancel") {
      session.pending = false;
      return json(session);
    }
    if (path === "/api/boxai/logout") {
      session.authenticated = false;
      return json(session);
    }
    if (!session.authenticated || failNext) {
      failNext = false;
      session.authenticated = false;
      return json({ error: "expired" }, 401);
    }
    if (path === "/api/state") return json(state);
    if (path === "/api/models")
      return json(options.map((m) => ({ id: m.ref, name: m.label })));
    if (path === "/api/settings") {
      if (request.method === "POST")
        settings = { ...settings, ...(await request.json()) };
      return json(settings);
    }
    if (path === "/api/library") return json(library);
    if (path === "/api/library/skill")
      return json({ text: "# BoxAI tools\n\nUI fixture only." });
    if (path === "/api/library/skills/probe")
      return json({
        source: "fixture",
        candidates: [{ name: "review", path: "review", have: false }],
      });
    if (path === "/api/library/servers/save") {
      const body = await request.json();
      const index = library.servers.findIndex((s) => s.name === body.old);
      if (index < 0) library.servers.push(body.server);
      else library.servers[index] = body.server;
      return json(library);
    }
    if (path.startsWith("/api/library/")) return json(library);
    if (path === "/api/set") {
      const body = await request.json();
      state.agents
        .find((a) => a.id === body.agent)
        .fields.find((f) => f.key === body.field).value = body.value;
      return json(state);
    }
    if (path === "/api/diagnostics")
      return json({
        running: true,
        url: "http://127.0.0.1:17890",
        calls: [{ model: "boxai/gpt-5", status: 200 }],
      });
    if (path === "/api/installer/check")
      return json({ available: true, version: "2.0.1 (fixture)" });
    return new Response(null, { status: 204 });
  },
});
console.log(`BoxAI Connect UI FIXTURE ONLY on ${server.url}`);
