const assert = require("node:assert/strict");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const { fixture } = require("./fixtures/caller-keys.cjs");

for (const lang of ["en", "vi"]) for (const width of [1280, 420]) {
  test(`BoxAI ${lang} ${width}: gate, account billing and separate Sessions`, async (t) => {
    const browser = await (process.env.BROWSER === "webkit" ? webkit.launch() : chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chromium" }),
    }));
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(8000);
    const errors = [], calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let authenticated = false;
    let releaseState, stateRequested;
    const heldState = new Promise((resolve) => { releaseState = resolve; });
    const requestingState = new Promise((resolve) => { stateRequested = resolve; });
    t.after(() => releaseState());
    const upstream = fixture(lang, "light", []);
    const account = { account: { id: 9, username: "fixture" }, usage: {
      wallet_quota_remaining: 765432, lifetime_quota_used: 123, lifetime_request_count: 4,
    }, billing: { subscriptions: [] } };
    await page.route("**/*", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript",
        body: `window.bootPrefs=${JSON.stringify({ boxaiOnly: true, lang, uiToken: "fixture-token" })};` });
      if (url.pathname.startsWith("/api/")) {
        calls.push(url.pathname);
        if (url.pathname === "/api/boxai/session") return route.fulfill({ json: { authenticated } });
        if (url.pathname === "/api/boxai/login") {
          assert.equal(request.headers()["x-boxai-ui-token"], "fixture-token");
          authenticated = true;
          return route.fulfill({ json: { authenticated } });
        }
        assert.ok(authenticated, `private request before login: ${url.pathname}`);
        if (url.pathname === "/api/state") {
          stateRequested();
          await heldState;
        }
        if (["/api/usage", "/api/boxai/account"].includes(url.pathname)) return route.fulfill({ json: account });
        if (url.pathname === "/api/provider/models") return route.fulfill({ json: {} });
      }
      return upstream(route);
    });
    await page.goto("http://magpie.test/");
    await page.locator("#boxaiLogin:not([disabled])").waitFor();
    assert.equal(await page.locator("#nav").isVisible(), false);
    assert.deepEqual(calls.filter((p) => p !== "/api/boxai/session"), []);
    await page.locator("#boxaiLogin").click();
    await requestingState;
    assert.equal(await page.locator("#nav").isVisible(), false, "navigation stays gated while startup is pending");
    releaseState();
    await page.locator("body:not(.boxai-locked)").waitFor();
    assert.equal(await page.locator("#nav [data-view=providers]").count(), 0);
    assert.equal(await page.locator("#nav [data-view=masking]").count(), 0);
    assert.equal(await page.locator("#nav button").last().getAttribute("data-view"), "account");
    assert.equal(await page.locator("#nav [data-view=sessions]").count(), 1);
    // With no models yet, onboarding must lead to the BoxAI account rather
    // than opening the upstream provider editor behind the account page.
    assert.equal(await page.locator(".guide-step[data-step=source]").getAttribute("aria-label"), "BoxAI");
    await page.locator(".guide-step[data-step=source] button").click();
    await page.locator("#view-account").getByText("fixture", { exact: true }).waitFor();
    assert.equal(await page.locator("#modal").isVisible(), false);
    // Navigate through the same handler as sidebar clicks, without Playwright's
    // scrollIntoView fighting the app's intentional scroll guard at 420px.
    await page.evaluate(() => show("usage"));
    await page.locator("#boxaiUsage").getByText("765432", { exact: true }).waitFor();
    assert.equal(await page.locator("#usageTab").isVisible(), false);
    await page.evaluate(() => show("account"));
    await page.locator("#view-account").getByText("fixture", { exact: true }).waitFor();
    assert.equal(await page.locator("#view-account").isVisible(), true);
    assert.equal(await page.locator("#view-usage").isVisible(), false);
    assert.equal(await page.evaluate(() => locale), lang);
    assert.deepEqual(errors, []);
  });
}
