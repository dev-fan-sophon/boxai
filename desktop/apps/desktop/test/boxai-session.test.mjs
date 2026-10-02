import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { BoxAISessionClient, boxaiOrigin } from "../electron/main/boxai-session.ts";

test("packaged origin is fixed; development permits only HTTP loopback", () => {
  assert.equal(boxaiOrigin(true, "https://evil.test"), "https://you-box.com");
  assert.equal(boxaiOrigin(false, "http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const value of ["https://evil.test", "http://localhost.evil.test", "http://user@localhost", "http://localhost/path", "http://localhost?x=1"]) {
    assert.throws(() => boxaiOrigin(false, value));
  }
});

test("browser PKCE login rejects wrong state, exchanges code, refreshes once, and revokes", async () => {
  let stored;
  let request;
  let refreshes = 0;
  let revoked;
  const client = new BoxAISessionClient({
    origin: "https://you-box.com",
    read: async () => stored,
    write: async value => { stored = value; },
    openExternal: async url => {
      assert.equal(url, "https://you-box.com/desktop/authorize?request=authorization-id");
      const wrong = await fetch(`${request.redirect_uri}?state=wrong&code=stolen`);
      assert.equal(wrong.status, 400);
      const correct = await fetch(`${request.redirect_uri}?state=${request.state}&code=valid-code`);
      assert.equal(correct.status, 200);
    },
    fetch: async (url, init) => {
      assert.equal(init.redirect, "error");
      assert.equal(init.headers["X-BoxAI-Client"], "boxai-desktop");
      const body = init.body && JSON.parse(init.body);
      if (url.endsWith("authorization-requests")) {
        request = body;
        assert.equal(body.client_id, "boxai-desktop");
        assert.equal(body.code_challenge_method, "S256");
        return Response.json({ id: "authorization-id" });
      }
      if (url.endsWith("/token")) {
        assert.equal(body.code, "valid-code");
        assert.equal(body.redirect_uri, request.redirect_uri);
        assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), request.code_challenge);
        return Response.json({ access_token: "short", refresh_token: "refresh-one", api_key: "relay-only", expires_in: 1 });
      }
      if (url.endsWith("/refresh")) {
        refreshes++;
        assert.equal(body.refresh_token, "refresh-one");
        return Response.json({ access_token: "new-short", refresh_token: "refresh-two", expires_in: 3600 });
      }
      if (url.endsWith("/session-status")) {
        assert.equal(init.headers.Authorization, "Bearer new-short");
        return Response.json({ active: true });
      }
      if (url.endsWith("/revoke")) { revoked = body.refresh_token; return new Response(null, { status: 204 }); }
      throw new Error("Unexpected request");
    },
  });
  let changes = 0;
  const unsubscribe = client.onSessionChanged(() => { changes++; });
  await client.authorize();
  assert.equal(changes, 1);
  const sessions = await Promise.all([client.session(), client.session()]);
  assert.equal(refreshes, 1);
  assert.equal(changes, 2);
  assert.equal(sessions[0].api_key, "relay-only");
  assert.equal(sessions[1].refresh_token, "refresh-two");
  await client.logout();
  assert.equal(revoked, "refresh-two");
  assert.equal(stored, undefined);
  assert.equal(changes, 3);
  unsubscribe();
  await client.logout();
  assert.equal(changes, 3);
  await assert.rejects(client.session(), /Sign in/);
});

test("inactive session clears credentials, network failure preserves them for retry", async () => {
  for (const status of [401, 503]) {
    let stored = { access_token: "a", refresh_token: "r", api_key: "k", expiresAt: Date.now() + 3600000 };
    const client = new BoxAISessionClient({ origin: "https://you-box.com", read: async () => stored,
      write: async value => { stored = value; }, openExternal: async () => {},
      fetch: async () => new Response(null, { status }) });
    await assert.rejects(client.session(), new RegExp(String(status)));
    assert.equal(Boolean(stored), status === 503);
  }
});
