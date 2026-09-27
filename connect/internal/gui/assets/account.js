// BoxAI authentication is the boundary around the original Magpie views.
// Reloading after revocation also discards private state inside upstream closures.
const boxai = (() => {
  const nativeFetch = window.fetch.bind(window);
  let authenticated = false, pending = false, busy = false, started = false, ready = false;
  let retryAction = "session";
  let epoch = 0, requestID = 0, timer, verificationError = "";
  let accountData = null, usageRequest = 0, accountRequest = 0;
  const controllers = new Set();
  const sessionPaths = new Set(["/api/boxai/session", "/api/boxai/login", "/api/boxai/cancel", "/api/boxai/logout", "/api/boxai/verify"]);

  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return nativeFetch(input, options);
    const session = sessionPaths.has(url.pathname);
    if (!session && !authenticated) throw new Error(t("Sign in with BoxAI"));
    const generation = epoch;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    const method = (options.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-BoxAI-UI-Token", window.bootPrefs?.uiToken || "");
    const controller = new AbortController();
    controllers.add(controller);
    const signal = options.signal || (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await nativeFetch(input, { ...options, headers, signal: controller.signal });
      if (generation !== epoch) throw new Error(t("Session changed. Please try again."));
      if (response.status === 401 && authenticated) {
        revoke();
        throw new Error(t("Sign in with BoxAI"));
      }
      // Upstream routing reads fetch().json() directly, rather than using api().
      const json = response.json.bind(response);
      response.json = async () => {
        const data = await json();
        if (generation !== epoch) throw new Error(t("Session changed. Please try again."));
        return data;
      };
      if (!session && response.status === 503) throw new Error(t("Account verification is temporarily unavailable. Please retry."));
      return response;
    } finally {
      controllers.delete(controller);
      signal?.removeEventListener("abort", abort);
    }
  };

  function lock() {
    authenticated = false;
    epoch++;
    requestID++;
    clearTimeout(timer);
    for (const controller of controllers) controller.abort();
    controllers.clear();
    document.body.classList.add("boxai-locked");
    $("#loginGate").hidden = false;
    for (const node of $$(".view")) node.hidden = true;
    for (const node of $$("dialog[open]")) node.close();
    closePicker();
    $("#modal").hidden = true;
    $("#modal .dialog").replaceChildren();
    state = { agents: [], profiles: [], catalog: "", settings: {} };
    providers = prefs = usage = quotas = accountData = null;
    editing = draft = importing = importingApps = null;
    expandedCalls.clear();
  }

  function reloadClean() {
    // Unsaved library text must not keep a revoked account's document alive.
    window.addEventListener("beforeunload", (event) => event.stopImmediatePropagation(), { capture: true });
    location.reload();
  }

  function revoke() {
    lock();
    reloadClean();
  }

  function renderGate(message = "") {
    const signoutPending = message.startsWith("Sign-out pending:");
    $("#loginState").textContent = message || (pending ? t("Finish signing in in your browser. You can cancel and try again.") : "");
    $("#boxaiLogin").hidden = pending || signoutPending;
    $("#boxaiLogin").disabled = busy;
    $("#boxaiCancel").hidden = !pending;
    $("#boxaiCancel").disabled = busy && retryAction !== "session";
    $("#boxaiRetry").hidden = !message || pending || busy;
    $("#boxaiRetry").onclick = signoutPending ? logout : () => started ? reloadClean() : sessionRequest(retryAction);
  }

  async function accept(session) {
    pending = !!session.pending;
    verificationError = session.error || "";
    if (!session.authenticated) {
      if (authenticated) { revoke(); return; }
      renderGate(verificationError);
      return;
    }
    authenticated = true;
    pending = false;
    $("#loginGate").hidden = true;
    document.body.classList.remove("boxai-locked");
    if (!started) {
      started = true;
      const generation = epoch;
      await load();
      if (!authenticated || generation !== epoch) return;
      // These original modules start their own polls; never execute them at the gate.
      for (const source of ["routing.js", "library.js"]) {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = source;
          script.onload = resolve;
          script.onerror = () => reject(new Error(t("Could not load the app. Please retry.")));
          document.body.append(script);
        });
        if (!authenticated || generation !== epoch) return;
      }
      ready = true;
      const requested = params.get("import") ? "account" : params.get("view");
      show(mode === "window" && ["providers", "gateway", "routing", "usage", "library", "settings", "account"].includes(requested) ? requested : "agents");
      // The provider editor used to fetch models when saving a key. Website
      // login now supplies that key, so populate the original Agent pickers.
      api("provider/models", { id: "boxai" }).then(() => load()).catch((error) => status(error.message, "err"));
    }
  }

  async function sessionRequest(action = "session") {
    if (busy && !(action === "cancel" && retryAction === "session")) return;
    retryAction = action;
    clearTimeout(timer);
    const id = ++requestID;
    busy = true;
    renderGate(action === "session" && !authenticated && !pending ? t("Checking authorization…") : "");
    try {
      const result = await api("boxai/" + action, action === "session" ? undefined : {});
      if (id !== requestID) return;
      busy = false;
      await accept(result);
      if (authenticated && ["account", "usage"].includes(view)) {
        if (view === "account") await loadAccount(); else await loadUsage();
      }
    } catch (error) {
      if (id !== requestID) return;
      busy = false;
      verificationError = error.message;
      if (started && !ready) {
        lock();
        renderGate(error.message);
        return;
      }
      if (authenticated) {
        status(t("Account verification is temporarily unavailable. Please retry."), "err");
        if (view === "account" && accountData) renderAccount(accountData);
      } else renderGate(error.message);
    } finally {
      if (id === requestID) {
        busy = false;
        timer = setTimeout(() => sessionRequest(), pending ? 2500 : 60000);
      }
    }
  }

  async function logout() {
    if (busy && !authenticated) return;
    lock();
    busy = true;
    pending = false;
    renderGate(t("Signing out…"));
    try {
      await api("boxai/logout", {});
      reloadClean();
    } catch (error) {
      busy = false;
      renderGate(error.message);
      // Retain the gate, not private upstream closures, even if logout failed.
      $("#boxaiRetry").onclick = logout;
      $("#boxaiLogin").hidden = true;
    }
  }

  function detail(list, label, value) {
    const row = el("div", "row pref");
    const who = el("div", "who");
    who.append(el("div", "name", t(label)));
    row.append(who, el("span", "boxai-value", value === undefined || value === null || value === "" ? "—" : String(value)));
    list.append(row);
    return row;
  }

  function renderAccount(data) {
    const page = $("#view-account"), account = data.account || {};
    const list = el("div", "list prefs");
    const identity = detail(list, "Account ID", account.id);
    if (account.id != null) identity.append(copyBtn(String(account.id), t("Account ID")));
    detail(list, "Username", account.username);
    detail(list, "Display name", account.display_name);
    detail(list, "Email", account.email);
    detail(list, "Group", account.group);
    detail(list, "Authorization", verificationError ? t("Verification temporarily unavailable") : t("Authorized"));
    const summary = el("div", "list prefs");
    detail(summary, "Wallet remaining (quota units)", data.usage?.wallet_quota_remaining);
    const subscriptions = data.billing?.subscriptions || [];
    detail(summary, "Subscriptions", subscriptions.length);
    for (const sub of subscriptions) {
      detail(summary, "Plan ID", sub.plan_id);
      detail(summary, "Status", sub.status);
    }
    const actions = el("div", "boxai-actions");
    for (const [label, path] of [["Top up", "/billing"], ["Manage subscription", "/billing#billing-subscription"], ["Account security", "/profile"]]) {
      const button = el("button", "text", t(label));
      button.onclick = () => api("open", { url: "https://you-box.com" + path }).catch((error) => status(error.message, "err"));
      actions.append(button);
    }
    const usageButton = el("button", "text", t("View usage details"));
    usageButton.onclick = () => show("usage");
    actions.append(usageButton);
    const sessionActions = el("div", "boxai-actions");
    const verify = el("button", "text", t("Reverify authorization"));
    verify.disabled = busy;
    verify.onclick = async () => {
      verify.disabled = true;
      await sessionRequest("verify");
      verify.disabled = false;
    };
    const signout = el("button", "text", t("Sign out"));
    signout.onclick = logout;
    sessionActions.append(verify, signout);
    page.replaceChildren(el("h2", "label", t("Account")), list,
      el("h2", "label", t("Balance and subscriptions")), summary,
      el("p", "note", t("Server-reported counters. Quota units are not currency.")), actions,
      sessionActions, el("p", "note", t("To switch accounts, sign out here, then choose another account on the BoxAI website when signing in.")));
  }

  async function loadAccount() {
    const id = ++accountRequest;
    const data = await api("boxai/account");
    if (!authenticated || id !== accountRequest) return;
    accountData = data;
    renderAccount(data);
  }

  async function loadUsage() {
    const id = ++usageRequest;
    const data = await api("usage");
    if (!authenticated || id !== usageRequest) return;
    let page = $("#boxaiUsage");
    if (!page) { page = el("section"); page.id = "boxaiUsage"; $("#view-usage").append(page); }
    const list = el("div", "list prefs");
    const raw = data.usage || {}, billing = data.billing || {};
    detail(list, "Wallet remaining (quota units)", raw.wallet_quota_remaining);
    detail(list, "Lifetime charged (quota units)", raw.lifetime_quota_used);
    detail(list, "Lifetime requests", raw.lifetime_request_count);
    detail(list, "Wallet fallback allowed", billing.wallet_fallback_allowed == null ? null : t(billing.wallet_fallback_allowed ? "Yes" : "No"));
    page.replaceChildren(el("h2", "label", t("Account-wide usage")), el("p", "note", t("Server-reported counters. Quota units are not currency.")), list, el("h2", "label", t("Subscriptions")));
    for (const sub of billing.subscriptions || []) {
      const section = el("section", "list prefs boxai-subscription");
      detail(section, "Subscription ID", sub.id);
      detail(section, "Plan ID", sub.plan_id);
      detail(section, "Status", sub.status);
      detail(section, "Unlimited", sub.unlimited == null ? null : t(sub.unlimited ? "Yes" : "No"));
      detail(section, "Allowance (quota units)", sub.quota_total);
      detail(section, "Used this period (quota units)", sub.quota_used_current_period);
      for (const [key, label] of [["current_period_start", "Period started"], ["end_time", "Subscription ends"], ["next_reset_time", "Next reset"]]) {
        const value = sub[key];
        const date = value ? new Date(typeof value === "number" ? value * 1000 : value) : null;
        detail(section, label, date && !Number.isNaN(date.getTime()) ? date.toLocaleString(locale === "zh" ? "zh-CN" : "en") : null);
      }
      detail(section, "Wallet fallback", sub.wallet_fallback == null ? null : t(sub.wallet_fallback ? "Yes" : "No"));
      page.append(section);
    }
    if (!billing.subscriptions?.length) page.append(el("p", "note", t("No subscriptions reported.")));
  }

  function start() {
    $("#boxaiLogin").onclick = () => sessionRequest("login");
    $("#boxaiCancel").onclick = () => sessionRequest("cancel");
    $("#boxaiRetry").onclick = () => started ? reloadClean() : sessionRequest(retryAction);
    sessionRequest();
  }
  return { get authenticated() { return authenticated; }, start, loadAccount, loadUsage };
})();
