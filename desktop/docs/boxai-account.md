# BoxAI account and gateway contract

Main integrations use `vendorOAuth.client.session()` for current credentials and
`onSessionChanged(listener)` for credential-free invalidation notifications.
Listeners run after persistence, must not throw, and must unsubscribe on disposal.

This fork replaces upstream provider configuration and third-party provider OAuth.
The renderer must show the account gate before opening the workspace. Credentials
remain in host-core's encrypted secret store, never in renderer state or IPC replies.

Authorization uses BoxAI Desktop's existing browser PKCE authorization request,
an ephemeral IPv4 loopback listener, random state, and S256 challenge. Refresh is
serialized with logout. A rejected session clears local credentials; transport
failures preserve credentials for retry. Logout only reports success after the
server revokes the refresh-token family and its relay key.

Production uses `https://you-box.com`. `BOXAI_DESKTOP_DEV_ORIGIN` is honored only
in unpackaged builds and only for HTTP loopback origins. It does not bypass login.

Only BoxAI provider rows can launch model work. Renderer key/endpoint/provider
mutation IPC is rejected. Native Pi session continuation is read-only because it
would otherwise execute with external credentials. Plugin completions and prompt
enhancement use the same launch boundary. Unsupported image generation and voice
providers cannot execute; no third-party live voice adapter is available.

The model set is the intersection of `/v1/models` and account-scoped
`/api/connect/provisioning` chat models. Exact server metadata supplies limits,
image-input support and reasoning efforts. Missing metadata uses conservative
runtime defaults, never metadata borrowed from another model. Claude uses Messages;
OpenAI and other families use Chat Completions. Responses is not enabled until
server capability evidence and live verification establish that route works.
All model credentials are the relay key minted by account authorization. Requests
carry `X-BoxAI-Client: boxai-desktop` and `User-Agent: BoxAI-Desktop`.

Acceptance scenarios: browser approval/denial, wrong-state rejection, cancellation,
concurrent refresh, revoked-session re-login, offline logout retry, model entitlement
intersection, metadata projection, rejected custom provider IPC, and signed-out UI
gate. Account balances are displayed in server quota units, not guessed currency.
Upstream tests for multi-provider editing, models.dev discovery and third-party
OAuth are superseded by `boxai-session.test.mjs` and `boxai-models.test.mjs`.
