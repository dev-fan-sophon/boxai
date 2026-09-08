# Bank QR top-up promotions and coupons

Discounts apply only to Bank QR **balance** top-ups, not subscription purchases
or other payment providers. Amounts are integer VND, timestamps are Unix seconds.
The credited USD amount derives from the original face amount, not the payment.

## API

All successful endpoints use `{ "success": true, "message": "", "data": ... }`.
Promotion/coupon management requires root authentication, matching payment
settings; payment review remains available to administrators. `/api/user/...`
requires the authenticated account. The promotion/coupon tables are independent
of generic option settings: changing options cannot bypass these validators.

### Promotion

- `GET /api/user/topup/promotion`: public-to-authenticated-users configuration.
- `GET /api/topup/promotion`: administrator configuration (same shape).
- `PUT /api/topup/promotion`: replace configuration; returns the saved object.

Default `data` (the activity and banner are disabled until explicitly enabled):

```json
{
  "id": 1,
  "enabled": false,
  "starts_at": 0,
  "ends_at": 0,
  "min_amount": 100000,
  "percent_off": 30,
  "max_discount": 100000,
  "per_user_limit": 0,
  "total_budget": 0,
  "banner_enabled": false,
  "banner_position": "console_top",
  "banner_text": ""
}
```

`banner_position` is `console_top`, `billing`, or `both`. `banner_text` is plain
text, at most 4000 UTF-8 bytes; empty allows the frontend's translated default.
Percentages are integers 1–100. Zero start/end means no bound; otherwise start is
inclusive and end exclusive. End must exceed start. `min_amount` and
`max_discount` range from 0 to 499999999; zero maximum means no cap. Per-user
limit is 0–1000000000; zero means unlimited. Total budget is 0–1000000000000000
VND, with zero unlimited. Budget is the sum of activity discounts reserved or
redeemed, not face amounts. Updating the singleton does **not** reset usage.

### Coupons

- `GET /api/topup/coupons?page=1&pagesize=20`: `data={items:[...],total:N}`,
  newest first; page size 1–100.
- `POST /api/topup/coupons`: create; returns saved object.
- `PUT /api/topup/coupons/:id`: replace; returns saved object.

```json
{
  "id": 1,
  "code": "WELCOME",
  "enabled": true,
  "starts_at": 0,
  "ends_at": 0,
  "min_amount": 100000,
  "discount_type": "percent",
  "discount_value": 10,
  "max_discount": 0,
  "total_limit": 0,
  "per_user_limit": 1,
  "user_id": 0,
  "stackable": true
}
```

Codes are trimmed, uppercased and validated as 1–64 ASCII letters, digits, `_`
or `-`. Codes are unique and cannot be renamed; disable and create a new code
instead. `discount_type` is `fixed` (value 1–499999999 VND) or `percent`
(integer value 1–100). The time/minimum/cap rules match promotion settings.
`user_id=0` permits any user; a positive ID permits only that existing user.
Total/per-user limits are 0–1000000000, zero unlimited. Usage is not reset by
editing a coupon. There is no delete API, preserving identities and audit data.

### Quote and payment

`POST /api/user/bank-qr/amount` and `POST /api/user/bank-qr/pay` accept:

```json
{"amount":100000,"coupon_code":"WELCOME"}
```

`amount` is the **face** VND amount, at least the configured Bank QR minimum
(and never below 10000), strictly below 500000000. `coupon_code` is optional.
Missing, disabled, expired, ineligible or exhausted supplied codes produce an
error rather than silently charging full price. Quote does not reserve a slot;
pay rechecks everything transactionally and its result is authoritative.

Both return these fields in `data` (example at 25000 VND/USD):

```json
{
  "amount":63000,"face_amount":100000,"activity_discount":30000,
  "coupon_discount":7000,"coupon_code":"WELCOME","credit_usd":4,
  "currency":"VND","expires_at":1788926400
}
```

Pay also returns `trade_no`, `transfer_content`, `payload`, `bank_name`,
`bank_bin`, `account_number`, `account_name`. The VietQR payload encodes exactly
the reserved payment amount. The order locks the original face, credit cents,
FX rate/source/quote time, applied discounts/code and expiry for 24 hours.

Without stacking, use the larger discount (ties favor activity); unused coupons
are not reserved and their returned code is empty. With stacking, subtract the
activity first and compute percentage coupons on the remainder. Both minimums
are evaluated against the face amount. Percentages round **down** to whole VND.
Any final payment ≤ 0 is rejected, not clamped to an arbitrary minimum.

### History, review and lifecycle

History and review retain their existing `amount` unit (credit, not payment).
They add `paid_amount`, `face_amount`, `activity_discount`, `coupon_discount`,
`coupon_code`, `credit_usd`, `expires_at`, `submission_status`. `money` continues
to mean payment. Legacy rows have zero/empty new fields: use `money` as fallback
and retain existing credit-unit handling. `submission_status` is empty initially,
then `submitted`, `rejected`, or `approved`; old rows are not backfilled.

`POST /api/user/topup/:trade_no/cancel`, empty body, returns `data:null`.
Cancellation sets order `status=cancelled` and is idempotent for its owner.
It accepts only pending Bank QR balance orders with no active submitted proof.
An expired order cannot submit or resubmit a proof. A proof already submitted
before expiry retains its discount hold and can still be approved after expiry.
Rejection retains a hold until expiry or cancellation; approval redeems it
permanently and cannot credit it twice. No additional pending-reminder API is
introduced: use history and existing submissions endpoints.

The order itself is the reservation ledger. All discount and review lifecycle
transactions first acquire a singleton database write lock (including SQLite,
which has no `FOR UPDATE`), then operate within the same transaction. Expired
unsubmitted and cancelled orders cease counting immediately in quota queries;
no cron or destructive deletion is required. Their stored `pending` status may
remain, so display effective expiry using `expires_at` and `submission_status`.

Discount API errors return HTTP 400 with `success:false`, a safe `message`, and
one of `topup_discount_invalid`, `topup_coupon_unavailable`,
`topup_discount_non_positive`, `topup_order_expired`, `topup_submission_active`,
`topup_order_unavailable`, `topup_discount_failed`. Existing amount/proof APIs
retain their established validation-error envelope where applicable.

## Administrator operation and email reminders

Customers choose a face amount, apply an optional coupon, create the QR order,
then click **I have paid** and provide a screenshot or bank transaction reference.
Administrators review claims in **Pricing Center → Top-up Reviews**. A payment
claim never credits the wallet by itself. Verify the actual bank receipt against
the expected amount/reference before approval; a screenshot or email alone is
not evidence that the bank received funds. Rejection reasons remain visible to
the customer.

Configure the existing SMTP settings first, then enable top-up review emails
and specify up to ten unique recipient addresses in payment settings. The
root-only `/api/option/` API saves the complete setting as one JSON string:

```json
{
  "key": "TopUpReviewNotificationSettings",
  "value": "{\"enabled\":true,\"recipients\":[\"admin@example.com\"]}"
}
```

The payment claim and one delivery record per recipient commit in the same
transaction. SMTP runs asynchronously in the existing master-node system task
runner (`topup_review_email`). Failed deliveries retry with exponential backoff,
capped at one hour; restarting the process does not lose the queue. SMTP has a
deadline, and expired delivery claims can be recovered. Successful recipients
are not resent merely because another recipient failed. Already reviewed claims
and removed recipients are skipped; disabling notifications pauses delivery.

SMTP delivery is **at least once**: a crash after mail-server acceptance but
before saving delivery state can cause a duplicate reminder, never duplicate
wallet credit. Delivery failures appear in system task history and server logs.
Emails contain an authenticated review-page link, not public proof attachments.

Back up the production database/configuration before additive migrations and
deploy API and frontend together. Verify health before enabling the campaign
and intended recipients. Do not create a publicly usable coupon automatically.
Verify campaign examples (100K → 70K, 300K → 210K, 500K → 400K), invalid/exhausted
coupons, stacking, cancellation/expiry, submitted-claim retention and repeated
approval. Use a local database for test payment/credit mutations rather than
fabricating credited production payments.
