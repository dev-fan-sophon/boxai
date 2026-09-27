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
let logoutFailures = 0;
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
      logoutFailures = patch.logoutFailures || 0;
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
      if (session.error?.startsWith("Sign-out pending"))
        return json({ error: session.error }, 409);
      session.pending = true;
      return json(session, 202);
    }
    if (path === "/api/boxai/cancel") {
      session.pending = false;
      return json(session);
    }
    if (path === "/api/boxai/logout") {
      if (logoutFailures > 0) {
        logoutFailures--;
        return json(
          { error: "Sign-out pending: fixture restore failure" },
          400,
        );
      }
      session.authenticated = false;
      session.pending = false;
      session.error = "";
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
    if (path === "/api/library/market/servers")
      return json({
        items: [
          {
            id: "boxai-media",
            title: "BoxAI Media",
            name: "BoxAI Media",
            inputs: [],
          },
        ],
      });
    if (path === "/api/library/market/skills")
      return json({
        items: [
          {
            id: "boxai-tools",
            name: "BoxAI Tools",
            source: "boxai",
            official: true,
          },
        ],
      });
    if (
      ["/api/library/market/server", "/api/library/market/skill"].includes(path)
    ) {
      const body = await request.json();
      requests.at(-1).body = body;
      const skill = path.endsWith("/skill");
      if (
        body.id !== (skill ? "boxai-tools" : "boxai-media") ||
        (skill && body.source !== "boxai") ||
        !Array.isArray(body.agents) ||
        !body.agents.length ||
        body.agents.some((id) => !library.agents.some((a) => a.id === id))
      )
        return json({ error: "invalid official installation" }, 400);
      return json({
        ...library,
        result: { changed: body.agents, problems: [] },
      });
    }
    if (path.startsWith("/api/library/"))
      return json({ error: "unsupported library operation" }, 404);
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
