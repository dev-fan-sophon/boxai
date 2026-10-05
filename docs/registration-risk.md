# Registration and trial-credit controls

The implementation is **default off**. Pushing to `main` does not authorize a
deployment, Turnstile activation, policy changes, or historical balance changes.
Obtain the owner's explicit production confirmation before any of those writes.

## Controls and limits

- Turnstile is verified server-side for every protected action. A successful
  challenge does not exempt the rest of the session. Tokens are sent in the
  `X-Turnstile-Token` header and refreshed after every attempt.
- Email codes expire in ten minutes, are single-use, and are invalidated after
  five incorrect attempts. Redis provides atomic verification when enabled;
  Redis errors fail closed. Without Redis, verification is process-local (use
  Redis for multiple application instances).
- `RegistrationRiskPolicy.enabled` forces email verification for password
  registrations. Password and OAuth account creation share an IP budget;
  explicit administrator-created accounts are exempt from that throttle.
- Registration, password-reset and trial verification emails share IP and
  mailbox budgets. IPv6 addresses share a /64 budget. Gmail/googlemail dot and
  plus aliases share an anti-abuse identity; other mail providers are not
  rewritten. Login identifiers and mail delivery addresses are unchanged.
- Blocked domains cover the named domain and its subdomains. The list is
  operator-maintained, not an automatic disposable-email reputation service.
  A shared IP or email provider alone is not evidence of an abusive person.
- Trial activation stops new automatic wallet signup and invitation gifts.
  Existing balances are not confiscated, migrated or reclassified.
- A user verifies their own currently bound email and submits a pending claim.
  Only a root administrator can approve or reject it, with an audit reason.
  One canonical mailbox and one user can claim once, including after account
  deletion. Approval uses the current eligibility cutoff and domain policy.
- Approved grants have a separate ledger, expiry, exact model allowlist,
  concurrency and per-request quota caps. Each UTC day's budget reserves the
  **entire grant at approval**, not only spending. Refunds and expiry do not
  recycle that day's allocation.
- Paid subscriptions and wallets retain their existing priority and accounting.
  Trial funding is available only with no paid subscription and an empty wallet.
  API-token quota limits still apply. Trials require explicit bounded output
  tokens and single text requests; tools, opaque options, media generation and
  asynchronous tasks require paid funding.
- Request reservation, token quota and grant settlement share transactions.
  Duplicate finalization cannot mint credit. New spending stops when the trial
  switch is disabled, but existing reservations can still settle/refund.
- A provider reporting usage above available funding is recorded at its actual
  usage, with the unfunded amount in administrator-only log metadata, and the
  grant is suspended. These caps are **not an absolute upstream-cost guarantee**.

## Activation after approval

1. Verify `common.RealClientIP` receives authentic client addresses through the
   deployed nginx/Cloudflare chain. Do not use registration-IP aggregates for
   bans until proxy attribution is established.
2. In the canonical BoxAI Cloudflare account, create/configure a Turnstile widget
   restricted to the actual BoxAI hostnames. Store its secret privately. Set
   `TurnstileSiteKey` and `TurnstileSecretKey` before `TurnstileCheckEnabled=true`.
   Both keys are required; Siteverify must be reachable. Test real registration,
   email sending, login and trial submission; local mocks do not prove live CF
   or SMTP integration. Turnstile is not a blanket OAuth callback challenge.
3. Deploy via the documented host release process only after confirmation.
   Startup adds the counter, grant, reservation and daily-budget tables through
   the existing migration path. Back up the database before deployment.
4. Read `RegistrationRiskPolicy` from the root options API, modify the complete
   JSON object, validate the chosen settings, then write it as one option value.
   This avoids partially enabling trials before limits exist. The shipped
   numbers below are **proposals**, not approved production policy:

   | Field | Default/proposal |
   |---|---|
   | `enabled`, `trial_enabled` | false |
   | `registration_ip_daily` | 20 |
   | `email_ip_hourly`, `email_identity_hourly` | 10, 3 |
   | `blocked_email_domains` | empty; populate only with reviewed domains |
   | `trial_eligible_after` | 0; explicitly choose a rollout Unix timestamp |
   | `trial_quota`, `trial_days` | 80000, 7 |
   | `trial_daily_budget` | 8000000 quota units allocated per UTC day |
   | `trial_max_concurrency`, `trial_max_request_quota` | 1, 20000 |
   | `trial_max_output_tokens` | 2048 |
   | `trial_models` | empty; choose exact, available, priced model IDs |

   Enabling trials requires enabled risk controls, a positive cutoff, and a
   nonempty explicit model list. Policy reductions constrain existing grants;
   increasing concurrency/request/model policy does not enlarge grant snapshots.
   The output-token limit is current policy, not a grant snapshot.
5. Exercise registration → verified claim → root review → allowed text request
   → settlement/refund with dedicated test accounts. Verify that paid wallet
   balances remain unchanged and forbidden models/media are rejected.

## Support and root-only operations

Users see claim status on Billing. Approval/configuration currently use the
existing authenticated management API, not a new administrator dashboard.

| Method and path | Purpose |
|---|---|
| GET `/api/user/trial` | Session user's public grant view |
| POST `/api/user/trial/verification` | Fresh challenge; email to bound address |
| POST `/api/user/trial` | Fresh challenge and `{"code":"abcdef"}` |
| GET `/api/user/trial/reviews?status=pending` | Root review queue |
| POST `/api/user/:id/trial/review` | Root `{"approve":true,"reason":"…"}` |
| GET `/api/user/trial/reservations?state=reserved&user_id=123` | Root investigation |
| POST `/api/user/trial/reservations/:request/reconcile` | Root manual finalization |

List endpoints accept the existing `p` and `page_size` pagination parameters.
Never expose administrator audit reasons or identity hashes in a user response.

Crash reservations are deliberately not auto-refunded: upstream work may have
completed and incurred cost. Investigate the request ID against relay and
upstream logs, and confirm no active worker remains before reconciliation.
The API rejects reserved entries updated in the last ten minutes; this age
check alone does **not** establish that work has stopped. Use
`{"actual_quota":123,"refund":false,"reason":"upstream usage verified"}`
to settle, or `{"actual_quota":0,"refund":true,"reason":"not dispatched"}`
only when no billable work occurred. Repeated calls return the finalized result
without charging/refunding again. Root identity and reason are audited.

To pause trials, set only `trial_enabled=false` while retaining risk controls,
and explicitly set `QuotaForNewUser=0`, `QuotaForInviter=0`, `QuotaForInvitee=0`
if automatic gifts must remain disabled: with trials off, legacy gift options
apply again. Keep reservation tables for reconciliation; never delete ledger
rows to reset eligibility. Historical grants/wallets require separate review
and authorization before alteration.

## Verification scope

Deterministic tests cover single-use codes, fresh challenges, canonical identity,
approval budgets, reservation concurrency, token limits, exact refunds, expiry,
kill switch, soft-deleted keys, overrun suspension and request-output bounds.
Database execution tests currently use SQLite; MySQL/PostgreSQL use the common
locking helper and portable SQL but require deployment-environment validation.
Do not claim live Turnstile, SMTP or production migration verification until
those checks have actually run after deployment authorization.
