# Plan: auto-email approved businesses (trial welcome + payment link)

Status: CODE IMPLEMENTED 2026-07-09 (Dan approved "follow the plan, do everything").
All code + tests written; baseline gates green (typecheck, typecheck:functions,
lint, 1459 tests). Deploy steps remain Dan-gated and blocked on the Resend API
key (see "Implementation status" below).
Requested by Dan: "when I approve a business on the admin dashboard they don't
get any notification. They need an auto-generated email telling them they are
on the trial, how everything works, and the link to pay for full access."

## Implementation status (2026-07-09)

Done (in working tree, uncommitted):
- WI-1 `supabase/migrations/20260809120000_business_approval_email.sql` — adds
  approval_email_sent_at / approval_email_decision / checkout_token_hash /
  checkout_token_expires_at + partial unique index. NOT applied (Dan-gated).
- WI-2 `supabase/functions/_shared/approval-email.ts` — `sendApprovalEmail`,
  Resend HTTP, idempotent, best-effort (returns warning, never throws), stores
  only the token hash, never logs key/token/provider body.
- WI-3 hooked into `admin-business-applications` (approve tiers only) and
  `admin-trial-create-from-prospect`; both return `approval_email_warning`,
  surfaced by `trial-requests.js` + `admin-new-trial.js`.
- WI-4 `supabase/functions/business-checkout-link/index.ts` + config.toml entry
  (verify_jwt=false). Public; resolves the app token, returns `signup_required`
  until the business is linked, else mints a single-use billing token and
  self-calls `stripe-create-checkout-session` (source "email").
  DEVIATION FROM PLAN: uses an internal HTTPS self-call to the existing audited
  checkout function instead of refactoring its core into `_shared/`. Reason: that
  function is money-critical and pinned by ~20 exact-string assertions in
  `billing-functions-source.test.ts`; the self-call reuses every guard with zero
  changes to that function, which is the smaller, safer change.
- WI-5 `website/business/billing/checkout/{index.html,checkout.js}` + vercel
  rewrites for `/business/billing/checkout/:token`.
- WI-6 `supabase/functions/_shared/approval-email-source.test.ts` + a
  business-checkout-link block in `billing-functions-source.test.ts`.

Remaining (Dan-gated, cannot run without keys/prod access):
1. Create Resend API key (send-only) + set Supabase secret `RESEND_API_KEY`.
2. Apply the WI-1 migration.
3. Deploy functions: `admin-business-applications`,
   `admin-trial-create-from-prospect`, `business-checkout-link`.
4. Deploy the website (Vercel).
5. Verify `app_runtime_config.purchase_surface` = `web_only` and
   `billing_environment` before QA (source "email" checkout requires web_only).
6. QA per the deploy sequence below (use Stripe TEST mode).

## Audit findings (verified against code 2026-07-09)

1. **Approval happens in two edge functions, no email anywhere.**
   - `supabase/functions/admin-business-applications/index.ts` → `applyDecision()`
     handles both the trial-requests "decide" action and the founder field-invite
     "create" action. Approval decisions are `approve_limited` (14-day trial,
     1 offer, 25 claims) and `approve_full` (30-day trial, 3 offers, 50 claims).
   - `supabase/functions/admin-trial-create-from-prospect/index.ts` is a second
     approval entry point (prospect command center) that also flips
     `business_applications` to `trial_limited`/`trial_active`.
2. **Email provider already exists: Resend.** Supabase Auth SMTP is
   `smtp.resend.com`, sender `support@twoferapp.com`, domain DKIM/SPF verified
   (see `docs/SMTP_SWAP_CHECKLIST.md`). No edge function currently sends email
   and there is no `RESEND_API_KEY` secret yet — transactional email should use
   Resend's HTTP API (`https://api.resend.com/emails`) with a new secret.
3. **The payment path was pre-built for exactly this email but never wired.**
   `stripe-create-checkout-session` accepts `source: "email"` and a
   `billing_token` (table `public.billing_tokens`, hashed, single-use,
   expiring, `action = 'subscription_checkout'`) — but **nothing mints tokens
   and no web page consumes them**. The in-app billing screens
   (`app/(tabs)/billing.tsx`, `app/(tabs)/account/billing.tsx`) are dead
   redirects; mobile compliance tests forbid the app from calling checkout.
   The website billing pages (`website/business/billing/*`) are static
   placeholder copy. So today there is **no self-serve way to pay at all** —
   this feature closes that gap, not just the notification gap.
4. **Timing wrinkle: at approval time the business usually does not exist.**
   The normal flow is website application → admin approves → owner downloads
   the app and signs up. `maybeMaterializeBusiness()` deliberately does not
   scan Auth by email, so `business_id` is usually NULL at decision time.
   `get-business-onboarding-context` materializes the business on first
   sign-in and **backlinks `business_applications.business_id`** (verified in
   its reconcile path). Checkout fundamentally requires a materialized
   business + owner (Stripe customer sync needs `businessId` + `ownerUserId`).
   → The emailed payment link must be **application-scoped** and exchange
   gracefully: if the business is linked, go to Stripe; if not yet, show
   "finish app signup first, then tap this link again."
5. **Guards already in place that the design must respect:**
   - `loadRuntimeBillingConfig`: checkout from `source !== "admin"` is refused
     unless `purchase_surface` is `web_only`. Verify the prod
     `app_runtime_config` value before QA.
   - CORS allowlist (`_shared/cors.ts`) already includes
     `https://www.twoferapp.com` — the new web page works without CORS edits.
   - `website/business/billing/success` and `/cancel` pages already exist for
     Stripe redirect targets.
   - `business_applications` has **no language column**; v1 email is English
     with a one-line ES/KO footer pointing to support (do not build per-language
     templates without new data).

## Design decision

Send the email server-side from the approval functions via Resend HTTP API.
The payment link is `https://www.twoferapp.com/business/billing/checkout/<token>`
where `<token>` is a new application-scoped checkout token. A small public
edge function exchanges the token: application → linked `business_id` → mints
an internal single-use `billing_tokens` row → calls the existing
checkout-session logic → returns the Stripe URL. This reuses the audited
billing pipeline (`ensureStripeCustomerForBusiness`, webhook mapping, trial
guards) instead of Stripe Payment Links, which would bypass customer/metadata
binding and the trial-reuse guards.

Email failure must NEVER fail the approval. Mirror the existing
`billing_sync_warning` pattern: catch, audit-log
(`admin_business_application_approval_email_failed`), return
`approval_email_warning` in the response so the dashboard can surface it.

## Work items

### WI-1 — Migration (GATED: Dan must approve before `db push`)

New file `supabase/migrations/<ts>_business_approval_email.sql`:

- Add to `business_applications`:
  - `approval_email_sent_at timestamptz` (idempotency — never double-send),
  - `approval_email_decision text` (which tier the sent email described),
  - `checkout_token_hash text` (sha256 of the emailed token),
  - `checkout_token_expires_at timestamptz`.
- Unique index on `checkout_token_hash` where not null.
- No RLS policy changes; the table already revokes anon/authenticated and is
  service-role only. **Do not touch any policy or policy helper.** (If any RLS
  file is touched anyway, run `node scripts/probe-rls-smoke.mjs` immediately
  after applying — standing rule.)

### WI-2 — Shared email module

New `supabase/functions/_shared/approval-email.ts`:

- `sendApprovalEmail({ supabaseAdmin, application, decision, requestId })`.
- Reads `RESEND_API_KEY` from env; if missing, log + return a warning string
  (never throw, never block approval, never print the key or raw provider
  response bodies — same rule as AI provider failures).
- Skip if `approval_email_sent_at` is already set (idempotent across the two
  approval functions and admin re-decides). On success, stamp
  `approval_email_sent_at` + `approval_email_decision`.
- Generates the checkout token: `crypto.randomUUID()` twice or 32 random
  bytes base64url; store only the sha256 hex in `checkout_token_hash`;
  expiry 30 days (covers the longest trial). The raw token appears ONLY in the
  email body — never in logs, audit rows, or function responses.
- Content (English, plain and short per Dan's copy preference; one-line ES/KO
  footer: "¿Prefieres español? / 한국어로 도움이 필요하세요? support@twoferapp.com"):
  - Subject: "You're approved — your Twofer trial is live".
  - You're approved: business name, trial length and limits pulled from the
    decision config actually applied (14d/1 offer/25 claims or
    30d/3 offers/50 claims — read from the application row's
    `trial_days/trial_offer_limit/trial_claim_limit`, don't hardcode).
  - How it works, 3 steps: 1) download Twofer, 2) sign up as a Business with
    THIS email address (that's how the trial attaches), 3) publish your first
    deal; redemptions happen in-store by QR.
  - Payment link: "Keep full access after your trial" →
    `https://www.twoferapp.com/business/billing/checkout/<raw-token>`.
    Note under it: complete app signup first if you haven't.
  - Support: support@twoferapp.com. From: `Twofer <support@twoferapp.com>`.
- HTML + plain-text parts; no images, no tracking.

### WI-3 — Hook into both approval functions

- `admin-business-applications/index.ts`: at the end of `applyDecision()`,
  only for `approve_limited`/`approve_full`, call `sendApprovalEmail` and add
  `approval_email_warning` to the JSON response. Audit-log a
  `..._approval_email_sent` action on success.
- `admin-trial-create-from-prospect/index.ts`: same call after its approval
  write.
- Dashboard JS (`website/admin/trial-requests.js`, `admin-new-trial.js`):
  append the warning to the existing status line exactly like
  `billing_sync_warning` is handled today (lines ~367 and ~130). No new UI.

### WI-4 — Token exchange edge function

New `supabase/functions/business-checkout-link/index.ts` (public, no JWT):

- POST `{ token }`. Hash, look up application by `checkout_token_hash`,
  check expiry and that status is still `trial_limited`/`trial_active`/
  `approved_not_billed`/`active`-eligible.
- If `application.business_id` is NULL → 200 with
  `{ ok: false, reason: "signup_required" }` (page shows the friendly
  message). Do NOT consume the token.
- If linked → mint a `billing_tokens` row (`action: 'subscription_checkout'`,
  `max_uses: 1`, short expiry ~30 min) and invoke the checkout-session logic
  with `source: "email"` and that token, returning `{ ok: true, url }`.
  Prefer refactoring the session-creation core of
  `stripe-create-checkout-session` into `_shared/` over an HTTP self-call;
  keep every existing guard (trial-reuse, purchase_surface, live-mode check).
- Rate-limit by IP/token (simple in-function counter table or reuse an
  existing pattern) — it's an unauthenticated endpoint. Generic error
  messages only ("This link isn't available"), never internals.
- The application checkout token is multi-use until expiry (owner may click
  before signing up), which is safe because it can only ever start checkout
  for its own application's business.

### WI-5 — Website checkout page

New `website/business/billing/checkout/index.html` + small JS (follow
`website/business/claim/claim.js` as the pattern — token from path, POST to
the function endpoint):

- Loading state → on `ok: true` redirect to the Stripe URL.
- `signup_required` → short copy: "Almost there — create your business account
  in the Twofer app with the email we approved, then open this link again."
  Links to app download.
- Invalid/expired → "This link has expired. Email support@twoferapp.com."
- `noindex,nofollow`, localization hooks like sibling billing pages.
- Vercel rewrite so `/business/billing/checkout/<token>` serves the page
  (mirror how `/business/claim/<token>` is routed in `website/vercel.json`).

### WI-6 — Tests + validation

- New `supabase/functions/_shared/approval-email-source.test.ts` following the
  existing source-test pattern (`business-application-source.test.ts`):
  approval paths call sendApprovalEmail only on approve decisions; failures
  produce a warning not a throw; raw token never logged; RESEND_API_KEY never
  echoed.
- Extend `billing-functions-source.test.ts` expectations for the new exchange
  function: keeps the purchase_surface guard, keeps live-mode check, generic
  errors.
- Confirm `lib/billing/mobile-stripe-compliance.test.ts` and
  `no-auto-trial.test.ts` still pass untouched (nothing here adds
  checkout to the mobile app).
- Run: `npm run typecheck`, `npm run typecheck:functions`, `npm run lint`,
  `npm test`.

## Deploy sequence (every step Dan-gated per CLAUDE.md)

1. Dan creates a Resend API key (Resend dashboard → API keys, send-only) and
   approves setting secret `RESEND_API_KEY` on the production Supabase project.
2. Dan approves applying the WI-1 migration.
3. Dan approves deploying edge functions: `admin-business-applications`,
   `admin-trial-create-from-prospect`, `business-checkout-link`,
   `stripe-create-checkout-session` (if refactored). Deploy from the worktree
   the edits live in (standing rule).
4. Dan approves the website deploy (Vercel) for the checkout page.
5. QA: create a throwaway application via `/business/start-trial`, approve it
   as `approve_limited` from `/admin/trial-requests`, confirm: email arrives
   (check Resend event log), dashboard shows no warning, clicking the pay link
   pre-signup shows the signup_required page, and post-signup reaches Stripe
   **test-mode** checkout (verify `app_runtime_config` billing_environment /
   purchase_surface first; do NOT complete a live-mode charge).

## Explicitly out of scope (follow-ups, don't build now)

- Trial-ending reminder emails — `billing_reminders` table already exists and
  is the natural home; separate task.
- Rejection / waitlist notification emails (worth doing, but Dan asked for
  approval only).
- Per-language email templates (needs a language column on applications).
- Migrating Supabase auth templates or anything about the SMTP setup.

## Notes for Opus

- Do not touch AI poster/prompt lock files; nothing here should go near them.
- Email copy: keep it minimal and plain — Dan's standing preference is few
  words. No marketing fluff.
- Never fail or slow the admin decision because of email; the decision write
  must land first, email is best-effort after it.
- Never log or return the raw checkout token or the Resend key anywhere.
- The two decision functions must share one email module — no copy-paste.
