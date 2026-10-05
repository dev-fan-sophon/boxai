# Registration abuse protection

Signup credit is automatically added to the normal wallet through the existing
`QuotaForNewUser` option. There is no claim form, manual approval, separate trial
ledger, model allowlist, expiry, daily credit budget or trial-specific output cap.
All models keep their existing prices and normal billing. Existing balances and
subscription accounting are unchanged.

When `RegistrationRiskPolicy.enabled` is true:

- Password registration requires email verification. Password and OAuth signup
  share a registration-IP budget; explicit administrator-created users do not.
- Registration/reset emails share per-IP and per-mailbox send budgets. Gmail
  dot/plus aliases and googlemail.com share a risk identity. Login and mail
  delivery addresses are not changed; IPv6 addresses share a /64 budget.
- Optional blocked domains also cover subdomains. Maintain the list from
  reviewed evidence, not assumptions about one shared IP or mailbox provider.
- Relay requests share **two concurrent HTTP requests per account**, across API
  keys and models, including the authenticated playground. A third request gets
  HTTP 429. A completed or failed request frees its slot immediately. Streaming
  requests hold their slot until the handler ends. Redis leases are renewed;
  store failures fail closed. Without Redis the limit is process-local.
- Asynchronous media submissions occupy a slot during their HTTP request, not
  until the upstream background job completes. There is no background-job cap.

Turnstile is independently controlled by `TurnstileCheckEnabled`. Protected
actions verify a fresh `X-Turnstile-Token` server-side; session success is not a
permanent bypass. Email codes are single-use, expire after ten minutes, and are
invalidated after five incorrect attempts. Redis errors fail closed; use Redis
for multi-instance code verification.

The risk option is one JSON value, with no model/pricing fields:

```json
{"enabled":true,"registration_ip_daily":20,"email_ip_hourly":10,"email_identity_hourly":3,"blocked_email_domains":[]}
```

These are signup/mail abuse thresholds, not generation rate or spending limits.
The feature ships disabled until explicitly activated. Pushing code alone never
authorizes a production deployment or policy change.

## Authorized rollout

1. Verify authentic client-IP forwarding through Cloudflare/nginx; do not ban
   users based on an unverified proxy IP.
2. Back up the database and configuration, then deploy through `make deploy`
   after the owner confirms going live. Startup creates only the registration
   counter table for this feature; no trial tables are needed.
3. Configure a Turnstile widget in the canonical BoxAI Cloudflare account,
   restricted to the actual BoxAI hostnames. Store its secret privately. Set
   `TurnstileSiteKey` and `TurnstileSecretKey` before enabling the check.
4. Enable the risk option through the root management API. Retain the existing
   signup-credit amount, model prices and normal quota validation. Do not
   re-enable unrelated legacy model rate limits as part of this rollout.
5. Verify health, fresh challenge rejection, registration email verification,
   ordinary wallet billing, and the two-in-flight/third-rejected boundary.

Setting the risk option's `enabled` to false disables its signup/mail thresholds
and concurrency check, without touching balances. Turnstile has its own switch.
Neither control alone establishes that an IP or email belongs to an attacker.
