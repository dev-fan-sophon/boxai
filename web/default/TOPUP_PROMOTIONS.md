# Top-up promotions frontend

Promotion and coupon management have an independent **Pricing Center → Top-up
promotion** tab (`/pricing-center/topup-promotions`), restricted to root admins.
Payment Gateway retains gateway configuration and payment-review email alerts.
Each configuration has its own save action. Top-up Reviews uses a scrollable
table with expandable proof/discount details and a fixed pagination footer.
Date inputs use
the administrator's browser timezone and serialize Unix seconds; blank means 0.
Limits, budgets and discount caps of 0 mean unlimited.

The console banner is mounted above authenticated page content (not just the
billing page). `banner_position` accepts `console_top`, `billing`, or `both`.
An empty `banner_text` uses translated, dynamic rules, including uncapped offers.
Custom text is plain text, not HTML. Public promotion data refreshes every minute.

## API contracts

- `GET /api/user/topup/promotion`, `GET/PUT /api/topup/promotion`: promotion object
  defined in `src/features/billing/promotions/api.ts`. PUT sends the whole object.
- `GET /api/topup/coupons?page=1&pagesize=20`: `{items,total}`. POST and PUT `/:id`
  send complete coupon objects. Existing codes cannot be renamed. User ID 0 means
  everyone; a positive ID restricts the coupon to that one user.
- `POST /api/user/bank-qr/amount` and `/pay`: `{amount,coupon_code}` where amount is
  face value in integer VND. Quotes do not reserve budget/usage. Payment creation
  recomputes and reserves; its response is authoritative for the QR and breakdown.
  Both return `amount` (payable VND), `face_amount`, `activity_discount`,
  `coupon_discount`, `coupon_code`, `credit_usd`, `expires_at`, `currency`.
  The payment response additionally contains the original bank and QR fields.
- History/review `amount` retains its old credited-unit meaning. Snapshot display
  uses `paid_amount || money`, never treats historical `amount` as payable VND.
- `POST /api/user/topup/:trade_no/cancel`: only unpaid pending orders without an
  active submission. `submission_status` hides invalid actions; server validation
  remains authoritative for old records without this field. `cancelled` has two Ls.
- `POST /api/user/topup/:trade_no/submissions`: multipart proof submission, not
  credit fulfillment. “I have paid” opens this existing review workflow. Expired
  orders cannot submit. Admin review and history refresh every 30 seconds while
  visible; the shared console pending-review reminder polls every 30 seconds.
- `GET/PUT /api/option/`, key `TopUpReviewNotificationSettings`, value is JSON text
  `{enabled,recipients}`. At most 10 valid email addresses, at least one when enabled.
  SMTP is configured separately; delivery and retries are backend responsibilities.

Only BankQR **balance** top-ups use these discounts; subscription payments do not.
Best discount wins unless a coupon is stackable; stacked coupons apply after the
activity discount. The frontend never calculates discount eligibility or charges.

HTTP 400 `topup_*` codes are translated locally for BankQR quote/pay, proof,
cancellation and promotion/coupon writes. These requests bypass global error
toasts to avoid duplicate untranslated messages. Legacy uncoded messages retain
backend localization. No global API interceptor was changed.

## Verification

```bash
bun run typecheck
bun run lint
bun run format:check
bun run build
# Against a running dev server or production preview; no API writes reach production:
TEST_BASE_URL=http://127.0.0.1:5173 CHROME_PATH=/path/to/chrome \
  node scripts/topup-promotions.browser.mjs
```

The browser test intercepts all `/api/**` traffic with fixtures and checks actual
rendered pages, management saves, email validation, out-of-order quotes, invalid
coupon guards, localized errors, changed pay amounts, proof submission without
direct credit, snapshots, cancellation, submitted/expired guards, and Vietnamese
mobile layout. Review screenshots are written to repository-root
`.amp/in/artifacts/`. Production API/database behavior needs integrated backend
tests separately; this browser suite intentionally cannot create real payments.
