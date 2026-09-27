// BoxAI Connect: vanilla DOM, with no product data requested before authentication.
const root = document.querySelector("#root");
const dialog = document.querySelector("#dialog");
const views = [
  "Agents",
  "Models",
  "MCP servers",
  "Skills",
  "Instructions",
  "Diagnostics",
  "Settings",
];
let session = { authenticated: false, pending: false };
let currentView = "Agents";
let state = null;
let library = null;
let prefs = null;
let availableModels = [];
let generation = 0; // invalidates every pending management request at logout/401
let pollTimer;
let noticeTimer;
let checking = true;
let gateError = "";
if (/^Mac/.test(navigator.platform)) document.body.classList.add("mac");
if (window.bootPrefs?.theme && window.bootPrefs.theme !== "system")
  document.documentElement.dataset.theme = window.bootPrefs.theme;

function node(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(label, action, className = "") {
  const b = node("button", className, t(label));
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await action();
    } catch (error) {
      if (error.name !== "AbortError")
        notify("Could not save this change. Check your input and try again.");
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
function notify(key) {
  clearTimeout(noticeTimer);
  document.querySelector("#notice").textContent = t(key);
  noticeTimer = setTimeout(() => {
    document.querySelector("#notice").textContent = "";
  }, 6500);
}
function locked(message = "") {
  generation++;
  session = { authenticated: false, pending: false };
  checking = false;
  state = library = prefs = null;
  availableModels = [];
  gateError = message;
  dialog.close();
  dialog.replaceChildren();
  document.querySelector("#notice").textContent = "";
  renderGate();
}
async function api(path, body) {
  const epoch = generation;
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-BoxAI-UI-Token": window.bootPrefs?.uiToken || "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    locked("Session expired. Sign in again to continue.");
    throw new DOMException("Signed out", "AbortError");
  }
  if (!response.ok) throw new Error("Request failed");
  const data = response.status === 204 ? null : await response.json();
  if (epoch !== generation)
    throw new DOMException("Stale response", "AbortError");
  return data;
}
function renderLanguage() {
  document.documentElement.lang = locale;
  const select = node("select");
  select.setAttribute("aria-label", t("Language"));
  for (const [value, name] of [
    ["vi", "Tiếng Việt"],
    ["en", "English"],
  ]) {
    const option = node("option", "", name);
    option.value = value;
    select.append(option);
  }
  select.value = locale;
  select.onchange = async () => {
    locale = select.value;
    localStorage.setItem("boxai-connect.lang", locale);
    renderLanguage();
    dialog.close();
    if (session.authenticated) {
      try {
        const settings = await api("settings");
        await api("settings", { ...settings, lang: locale });
      } catch {
        notify("Could not save this change. Check your input and try again.");
      }
      if (session.authenticated) await showView(currentView);
    } else renderGate();
  };
  document.querySelector("#language").replaceChildren(select);
}
function renderGate() {
  const gate = node("main", "gate");
  const card = node("section", "gate-card");
  const logo = node("img");
  logo.src = "boxai.png";
  logo.alt = "";
  card.append(
    logo,
    node(
      "h1",
      "",
      t(
        checking
          ? "Checking your session…"
          : session.pending
            ? "Continue in your browser"
            : "Your agents. One connection.",
      ),
    ),
  );
  if (!checking) {
    card.append(
      node(
        "p",
        "",
        t(
          session.pending
            ? "Complete sign-in in your browser. This window will update automatically."
            : "Sign in to connect your coding agents to BoxAI models, MCP servers and skills.",
        ),
      ),
    );
    if (gateError) {
      const error = node("p", "error", t(gateError));
      error.setAttribute("role", "alert");
      card.append(error);
    }
    card.append(
      button(
        session.pending ? "Cancel sign-in" : "Sign in with BoxAI",
        async () => {
          generation++;
          clearTimeout(pollTimer);
          try {
            await api(session.pending ? "boxai/cancel" : "boxai/login", {});
            await checkSession();
          } catch (error) {
            if (error.name !== "AbortError") {
              gateError = "Sign-in could not be completed. Please try again.";
              renderGate();
            }
          }
        },
        "primary",
      ),
    );
    card.append(
      node("p", "security", t("Secure browser sign-in · you-box.com")),
    );
  }
  gate.append(card);
  root.replaceChildren(gate);
  root.setAttribute("aria-busy", String(checking));
}
async function checkSession() {
  clearTimeout(pollTimer);
  const epoch = generation;
  try {
    const snapshot = await api("boxai/session");
    if (epoch !== generation) return;
    const wasAuthenticated = session.authenticated;
    session = snapshot;
    checking = false;
    if (!snapshot.authenticated) {
      if (wasAuthenticated)
        locked("Session expired. Sign in again to continue.");
      session = snapshot;
      if (snapshot.error)
        gateError = "Sign-in could not be completed. Please try again.";
      renderGate();
    } else if (!wasAuthenticated) {
      gateError = "";
      await showView("Agents");
    }
  } catch (error) {
    if (epoch === generation && error.name !== "AbortError")
      locked("Unable to connect. Check your connection and try again.");
  } finally {
    pollTimer = setTimeout(checkSession, session.pending ? 1500 : 15000);
  }
}
function shell() {
  const wrapper = node("div", "shell");
  const side = node("aside");
  const nav = node("nav");
  nav.setAttribute("aria-label", "BoxAI Connect");
  for (const view of views) {
    const b = button(view, () => showView(view));
    if (view === currentView) b.setAttribute("aria-current", "page");
    nav.append(b);
  }
  const account = node("div", "account");
  account.append(node("span", "badge", t("Connected to BoxAI")));
  account.append(
    node(
      "span",
      "identity",
      session.account?.display_name ||
        session.account?.displayName ||
        session.account?.username ||
        "BoxAI",
    ),
  );
  account.append(button("Account", () => api("account", {}), "quiet"));
  account.append(
    button(
      "Sign out",
      () =>
        confirmAction(
          "Sign out? Local agent connections will stop until you sign in again.",
          "Sign out",
          async () => {
            generation++;
            await api("boxai/logout", {});
            locked();
          },
        ),
      "quiet",
    ),
  );
  side.append(nav, account);
  const main = node("main", "workspace");
  wrapper.append(side, main);
  root.replaceChildren(wrapper);
  root.setAttribute("aria-busy", "false");
  return main;
}
function heading(main, description, action) {
  const head = node("div", "page-head");
  const text = node("div");
  text.append(node("h1", "", t(currentView)));
  if (description) text.append(node("p", "", t(description)));
  head.append(text);
  if (action) head.append(action);
  main.append(head);
}
function empty(main, title, description) {
  const card = node("section", "card empty");
  card.append(node("h2", "", t(title)));
  if (description) card.append(node("p", "", t(description)));
  main.append(card);
}
async function showView(view) {
  if (!session.authenticated) return;
  currentView = views.includes(view) ? view : "Agents";
  const selected = currentView;
  const epoch = generation;
  try {
    if (selected === "Agents") state = await api("state");
    if (selected === "Models") availableModels = await api("models");
    if (["MCP servers", "Skills", "Instructions"].includes(selected))
      library = await api("library");
    if (selected === "Settings") prefs = await api("settings");
    const diagnostics =
      selected === "Diagnostics" ? await api("diagnostics") : null;
    if (
      epoch !== generation ||
      selected !== currentView ||
      !session.authenticated
    )
      return;
    const main = shell();
    switch (selected) {
      case "Agents":
        renderAgents(main);
        break;
      case "Models":
        renderModels(main);
        break;
      case "MCP servers":
        renderMCP(main);
        break;
      case "Skills":
        renderSkills(main);
        break;
      case "Instructions":
        renderInstructions(main);
        break;
      case "Settings":
        renderSettings(main);
        break;
      case "Diagnostics":
        renderDiagnostics(main, diagnostics);
        break;
    }
  } catch (error) {
    if (error.name !== "AbortError" && session.authenticated) {
      const main = shell();
      heading(main);
      empty(main, "Unable to connect. Check your connection and try again.");
      main.append(button("Try again", () => showView(selected)));
    }
  }
}
function field(label, control) {
  const row = node("label", "field", t(label));
  row.append(control);
  return row;
}
function select(options, value) {
  const s = node("select");
  for (const [key, title] of options) {
    const o = node("option", "", title);
    o.value = key;
    s.append(o);
  }
  s.value = value;
  return s;
}
function agentLabel(value) {
  const labels = {
    model: "Model",
    small: "Small model",
    large: "Large model",
    effort: "Reasoning effort",
    thinking: "Reasoning effort",
    subagents: "Subagents",
    auth: "Connection",
    provider: "Connection",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Very high",
    minimal: "Minimal",
    max: "Maximum",
    none: "None",
    off: "Off",
    "": "Default",
    magpie: "BoxAI",
  };
  return t(labels[value] || value);
}
function renderAgents(main) {
  heading(
    main,
    "Choose the models your coding agents use.",
    button("Refresh", () => showView("Agents")),
  );
  if (!state.agents?.length)
    empty(
      main,
      "No agents detected",
      "Install and open a supported coding agent, then refresh this page.",
    );
  for (const agent of state.agents || []) {
    const card = node("section", "card");
    card.append(node("h2", "", agent.name), node("p", "path", agent.path));
    const fields = node("div", "fields");
    for (const f of agent.fields || []) {
      const options = (f.options || []).map((o) => [
        o.value,
        agentLabel(o.label || o.value),
      ]);
      const currentAllowed = options.some((o) => o[0] === f.value);
      if (!currentAllowed)
        options.unshift([
          f.value,
          t(f.value ? "Not connected to BoxAI" : "Default"),
        ]);
      const control = select(options, f.value);
      if (!currentAllowed) control.options[0].disabled = true;
      control.disabled = !(f.options || []).length;
      control.onchange = async () => {
        control.disabled = true;
        try {
          await api("set", {
            agent: agent.id,
            field: f.key,
            value: control.value,
          });
          await showView("Agents");
          notify("Saved. Restart the agent if it is already running.");
        } catch (error) {
          control.value = f.value;
          if (error.name !== "AbortError")
            notify(
              "Could not save this change. Check your input and try again.",
            );
        } finally {
          control.disabled = false;
        }
      };
      fields.append(field(agentLabel(f.label), control));
    }
    card.append(fields);
    if (agent.drift) {
      card.append(
        node("p", "warning", t("Configuration changed outside BoxAI Connect.")),
      );
      const actions = node("div", "buttons");
      for (const [action, label] of [
        ["reapply", "Restore connection"],
        ["keep", "Keep current configuration"],
      ]) {
        actions.append(
          button(label, async () => {
            await api(
              "agents/" + action + "/" + encodeURIComponent(agent.id),
              {},
            );
            await showView("Agents");
          }),
        );
      }
      card.append(actions);
    }
    main.append(card);
  }
}
function renderModels(main) {
  heading(
    main,
    "Models available to your BoxAI account. Select a model on the Agents page.",
  );
  const models = new Map(availableModels.map((m) => [m.id, m.name || m.id]));
  const search = node("input", "search");
  search.type = "search";
  search.placeholder = t("Search models");
  search.setAttribute("aria-label", t("Search models"));
  const list = node("div", "card model-list");
  search.oninput = () => {
    list.replaceChildren();
    for (const [id, name] of models)
      if ((id + name).toLowerCase().includes(search.value.toLowerCase())) {
        const row = node("div", "model");
        row.append(node("strong", "", name), node("div", "path", id));
        list.append(row);
      }
    if (!list.children.length)
      empty(
        list,
        models.size ? "No results" : "No models available",
        "Manage account access on you-box.com.",
      );
  };
  main.append(search, list);
  search.oninput();
}
function assignments(agents, selected, capability) {
  const group = node("div", "assignments");
  group.setAttribute("aria-label", t("Assign to agents"));
  for (const agent of agents || []) {
    if (capability && !agent[capability]) continue;
    const label = node("label");
    const check = node("input");
    check.type = "checkbox";
    check.value = agent.id;
    check.checked = (selected || []).includes(agent.id);
    label.append(check, document.createTextNode(agent.name));
    group.append(label);
  }
  if (!group.children.length)
    group.append(node("p", "", t("No compatible agents detected")));
  return group;
}
function chosen(group) {
  return [...group.querySelectorAll("input:checked")].map((e) => e.value);
}
async function libraryChange(path, body) {
  const result = await api("library/" + path, body);
  await showView(currentView);
  notify(
    result?.result?.problems?.length
      ? "Some agents could not be updated. Check their configuration files and permissions."
      : "Changes saved",
  );
}
function renderMCP(main) {
  heading(
    main,
    "Give your agents access to tools and services.",
    button("Add MCP server", () => editServer(), "primary"),
  );
  if (!library.servers?.length) empty(main, "No MCP servers yet");
  for (const server of library.servers || []) {
    const card = node("section", "card");
    const head = node("div", "card-head");
    const actions = node("div", "buttons");
    actions.append(
      button("Edit", () => editServer(server)),
      button(
        "Remove",
        () =>
          confirmAction(
            "Remove this item from the library and assigned agents?",
            "Remove",
            () => libraryChange("servers/remove", { name: server.name }),
          ),
        "danger",
      ),
    );
    head.append(node("h2", "", server.name), actions);
    card.append(
      head,
      node(
        "p",
        "path",
        server.transport === "stdio" ? server.command : server.url,
      ),
    );
    const group = assignments(library.agents, server.agents, "mcp");
    group.onchange = async () => {
      try {
        await libraryChange("servers/agents", {
          name: server.name,
          agents: chosen(group),
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          notify("Could not save this change. Check your input and try again.");
          await showView(currentView);
        }
      }
    };
    card.append(group);
    main.append(card);
  }
}
function openDialog(title) {
  dialog.replaceChildren();
  const h = node("h2", "", t(title));
  h.id = "dialog-title";
  dialog.append(h);
  const form = node("form");
  form.onsubmit = (e) => e.preventDefault();
  dialog.append(form);
  dialog.showModal();
  return form;
}
function confirmAction(message, label, action) {
  const form = openDialog(label);
  form.append(node("p", "", t(message)));
  const actions = node("div", "buttons");
  actions.append(
    button("Cancel", () => dialog.close()),
    button(
      label,
      async () => {
        await action();
        dialog.close();
      },
      "primary",
    ),
  );
  form.append(actions);
}
function inputField(form, label, value, multiline = false) {
  const input = node(multiline ? "textarea" : "input");
  input.value = value || "";
  input.autocomplete = "off";
  input.spellcheck = false;
  form.append(field(label, input));
  return input;
}
function editServer(server = {}) {
  const form = openDialog(server.name ? "Edit" : "Add MCP server");
  form.append(
    node(
      "p",
      "warning",
      t(
        "Only add tools you trust. MCP commands run on your computer when an agent starts them.",
      ),
    ),
  );
  const name = inputField(form, "Name", server.name);
  name.required = true;
  name.pattern = "[A-Za-z0-9][A-Za-z0-9_-]{0,63}";
  const transport = select(
    [
      ["stdio", "stdio"],
      ["http", "HTTP"],
      ["sse", "SSE"],
    ],
    server.transport || "stdio",
  );
  form.append(field("Transport", transport));
  const command = inputField(form, "Command", server.command);
  const args = inputField(
    form,
    "Arguments (JSON array)",
    JSON.stringify(server.args || []),
  );
  const env = inputField(
    form,
    "Environment (JSON object)",
    JSON.stringify(server.env || {}),
    true,
  );
  const url = inputField(form, "Server URL", server.url);
  const headers = inputField(
    form,
    "Headers (JSON object)",
    JSON.stringify(server.headers || {}),
    true,
  );
  const group = assignments(library.agents, server.agents, "mcp");
  form.append(node("h3", "", t("Assign to agents")), group);
  transport.onchange = () => {
    for (const e of [command, args, env])
      e.parentElement.hidden = transport.value !== "stdio";
    for (const e of [url, headers])
      e.parentElement.hidden = transport.value === "stdio";
  };
  transport.onchange();
  const actions = node("div", "buttons");
  actions.append(
    button("Cancel", () => dialog.close()),
    button(
      "Save",
      async () => {
        if (!form.reportValidity()) return;
        let parsedArgs, parsedEnv, parsedHeaders;
        try {
          parsedArgs = JSON.parse(args.value);
          parsedEnv = JSON.parse(env.value);
          parsedHeaders = JSON.parse(headers.value);
          if (
            !Array.isArray(parsedArgs) ||
            parsedArgs.some((v) => typeof v !== "string") ||
            !parsedEnv ||
            Array.isArray(parsedEnv) ||
            !parsedHeaders ||
            Array.isArray(parsedHeaders) ||
            Object.values(parsedEnv).some((v) => typeof v !== "string") ||
            Object.values(parsedHeaders).some((v) => typeof v !== "string")
          )
            throw new Error();
        } catch {
          notify("Invalid JSON. Check the arguments, environment and headers.");
          return;
        }
        await libraryChange("servers/save", {
          old: server.name || "",
          server: {
            name: name.value,
            transport: transport.value,
            command: command.value,
            args: parsedArgs,
            env: parsedEnv,
            url: url.value,
            headers: parsedHeaders,
            agents: chosen(group),
          },
        });
        dialog.close();
      },
      "primary",
    ),
  );
  form.append(actions);
}
function renderSkills(main) {
  heading(
    main,
    "Reusable skills, shared with the agents you choose.",
    button("Add skill", addSkill, "primary"),
  );
  if (!library.skills?.length) empty(main, "No skills yet");
  for (const skill of library.skills || []) {
    const card = node("section", "card");
    const head = node("div", "card-head");
    const actions = node("div", "buttons");
    actions.append(
      button("View skill", async () => {
        const data = await api(
          "library/skill?name=" + encodeURIComponent(skill.name),
        );
        const form = openDialog("View skill");
        form.append(
          node("pre", "", data.text),
          button("Close", () => dialog.close()),
        );
      }),
    );
    if (skill.kind === "github")
      actions.append(
        button("Update", () =>
          libraryChange("skills/update", { name: skill.name }),
        ),
      );
    actions.append(
      button(
        "Remove",
        () =>
          confirmAction(
            "Remove this item from the library and assigned agents?",
            "Remove",
            () => libraryChange("skills/remove", { name: skill.name }),
          ),
        "danger",
      ),
    );
    head.append(node("h2", "", skill.name), actions);
    card.append(head, node("p", "", skill.description));
    if (skill.missing) card.append(node("p", "warning", t("Missing files")));
    const group = assignments(library.agents, skill.agents, "skills");
    group.onchange = async () => {
      try {
        await libraryChange("skills/agents", {
          name: skill.name,
          agents: chosen(group),
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          notify("Could not save this change. Check your input and try again.");
          await showView(currentView);
        }
      }
    };
    card.append(group);
    main.append(card);
  }
}
function addSkill() {
  const form = openDialog("Add skill");
  form.append(
    node(
      "p",
      "warning",
      t(
        "Review skills before installing. Skills can instruct agents to run commands.",
      ),
    ),
  );
  const source = inputField(form, "Skill source", "");
  source.placeholder = t("Local folder or GitHub repository URL");
  source.required = true;
  const candidates = node("div");
  const group = assignments(library.agents, [], "skills");
  const inspect = button("Inspect source", async () => {
    if (!form.reportValidity()) return;
    candidates.replaceChildren();
    const probe = await api("library/skills/probe", { source: source.value });
    if (!probe.candidates?.length)
      candidates.append(node("p", "", t("No skills found at this source")));
    for (const candidate of probe.candidates || []) {
      const row = node("div", "row");
      row.append(node("span", "", candidate.name));
      row.append(
        candidate.have
          ? node("span", "badge", t("Installed"))
          : button(
              "Install",
              async () => {
                await libraryChange("skills/install", {
                  source: probe.source,
                  paths: [candidate.path],
                  agents: chosen(group),
                });
                dialog.close();
              },
              "primary",
            ),
      );
      candidates.append(row);
    }
  });
  source.oninput = () => candidates.replaceChildren();
  form.append(
    node("h3", "", t("Assign to agents")),
    group,
    inspect,
    candidates,
    button("Cancel", () => dialog.close()),
  );
}
function renderInstructions(main) {
  heading(main, "Shared instructions for your coding agents.");
  const form = node("form", "card");
  form.onsubmit = (e) => e.preventDefault();
  const text = inputField(
    form,
    "Shared instructions",
    library.instructions?.shared,
    true,
  );
  text.rows = 12;
  const selected = (library.instructions?.agents || [])
    .filter((a) => a.on)
    .map((a) => a.agent);
  const group = assignments(library.agents, selected, "instructions");
  form.append(
    node("h3", "", t("Assign to agents")),
    group,
    button(
      "Save",
      () =>
        libraryChange("instructions/save", {
          shared: text.value,
          agents: chosen(group),
        }),
      "primary",
    ),
  );
  main.append(form);
}
function renderDiagnostics(main, data) {
  heading(
    main,
    "Local gateway and recent requests. No request bodies or credentials are shown.",
    button("Refresh", () => showView("Diagnostics")),
  );
  const card = node("section", "card");
  const head = node("div", "card-head");
  head.append(
    node("h2", "", t("Local gateway")),
    node("span", "badge", t(data.running ? "Running" : "Stopped")),
  );
  card.append(head, node("p", "path", data.url));
  main.append(card);
  const recent = node("section", "card");
  recent.append(node("h2", "", t("Recent requests")));
  if (!data.calls?.length) empty(recent, "No requests yet");
  else {
    const table = node("table");
    const header = node("tr");
    for (const title of ["Model", "Status"])
      header.append(node("th", "", t(title)));
    table.append(header);
    for (const call of data.calls.slice(0, 30)) {
      const row = node("tr");
      row.append(
        node("td", "", call.model),
        node("td", "", String(call.status || "—")),
      );
      table.append(row);
    }
    recent.append(table);
  }
  main.append(recent);
}
async function savePrefs(patch) {
  prefs = await api("settings", { ...prefs, ...patch });
  if (prefs.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = prefs.theme;
  notify("Changes saved");
}
function renderSettings(main) {
  heading(main);
  const card = node("section", "card");
  for (const [key, title, options] of [
    [
      "theme",
      "Appearance",
      [
        ["system", t("System")],
        ["light", t("Light")],
        ["dark", t("Dark")],
      ],
    ],
    [
      "tray",
      "Tray icon",
      [
        ["panel", t("Quick panel")],
        ["window", t("Window")],
      ],
    ],
  ]) {
    const control = select(options, prefs[key]);
    control.onchange = async () => {
      const previous = prefs[key];
      try {
        await savePrefs({ [key]: control.value });
      } catch (error) {
        control.value = previous;
        if (error.name !== "AbortError")
          notify("Could not save this change. Check your input and try again.");
      }
    };
    const row = node("div", "row");
    row.append(field(title, control));
    card.append(row);
  }
  const privacy = node("section", "card");
  privacy.append(node("h2", "", t("Privacy")));
  for (const [key, title] of [
    ["dock", "Show in Dock"],
    ["redact", "Redact secrets in agent requests"],
    ["redactPersonal", "Redact personal information"],
  ]) {
    if (key === "dock" && !/^Mac/.test(navigator.platform)) continue;
    const row = node("div", "row");
    const label = node("label");
    const check = node("input");
    check.type = "checkbox";
    check.checked = !!prefs[key];
    check.onchange = async () => {
      try {
        await savePrefs({ [key]: check.checked });
      } catch (error) {
        check.checked = !check.checked;
        if (error.name !== "AbortError")
          notify("Could not save this change. Check your input and try again.");
      }
    };
    label.append(check, document.createTextNode(t(title)));
    row.append(label);
    (key === "dock" ? card : privacy).append(row);
  }
  const words = inputField(
    privacy,
    "Custom words to redact (one per line)",
    (prefs.redactWords || []).join("\n"),
    true,
  );
  privacy.append(
    button("Save", () =>
      savePrefs({
        redactWords: words.value
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean),
      }),
    ),
  );
  const about = node("section", "card");
  about.append(
    node("h2", "", t("About")),
    node("p", "", "BoxAI Connect · " + t("Version") + " " + prefs.version),
  );
  about.append(
    node("p", "path", t("Configuration folder") + ": " + prefs.dir),
    button("Open folder", () => api("settings/reveal", {})),
  );
  const updates = node("div", "row");
  updates.append(
    button("Check for updates", async () => {
      const release = await api("installer/check", {});
      if (!release.available) {
        notify("You are up to date");
        return;
      }
      confirmAction(
        "Download the verified installer and open it? Follow the installer to complete the update.",
        "Open installer",
        async () => {
          await api("installer/open", {});
          notify(
            "Installer opened. Follow its instructions to finish updating.",
          );
        },
      );
    }),
  );
  about.append(updates);
  const foot = node("div");
  foot.append(
    node(
      "p",
      "footnote",
      t(
        "Close keeps BoxAI Connect in the tray. Quit stops local agent connections.",
      ),
    ),
  );
  const actions = node("div", "buttons");
  actions.append(
    button("Open window", () => api("window/main", {})),
    button("Close to tray", () => api("window/hide", {})),
    button(
      "Quit",
      () =>
        confirmAction(
          "Quit BoxAI Connect? Local agent connections will stop.",
          "Quit",
          () => api("window/quit", {}),
        ),
      "danger",
    ),
  );
  foot.append(actions);
  main.append(card, privacy, about, foot);
}

renderLanguage();
renderGate();
checkSession();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkSession();
});
