# Plan: "Account not active" → Start Free Trial + admin pending-verification email

**Date:** 2026-07-10
**Status:** IMPLEMENTED 2026-07-10 (Tasks 1 & 2). Gates green
(typecheck / typecheck:functions / lint / 1471 tests). UNCOMMITTED. Task 4
optional items NOT done. Dan-gated deploy steps remain (see Deploy/rollout).
**Owner:** Dan (approvals) / Opus (implementation)

## What shipped (2026-07-10)

- `lib/legal-urls.ts` — added `BUSINESS_START_TRIAL_URL`
  (`EXPO_PUBLIC_BUSINESS_START_TRIAL_URL` override, defaults to the live page).
- `lib/merchant-access.ts` — added `isNeverActivatedBillingStatus()` +
  `NEVER_ACTIVATED_STATUSES` (`trial_eligible`, `trial_checkout_pending`; null
  treated as never-activated).
- `components/merchant-access-blocked-card.tsx` — two variants. Never-activated
  → "Verify your business" + primary "Start free trial" (→ start-trial page) +
  "same email you signed in with: <email>" (email read from `useAuthSession`,
  no call-site plumbing) + secondary "Contact support". Every other blocked
  status keeps the original inactive/contact-support card.
- `lib/i18n/locales/{en,es,ko}.json` — `merchantAccess.verifyTitle`,
  `verifyBody`, `verifyEmailHint`, `startTrialCta`.
- 3 call sites (`app/(tabs)/dashboard.tsx`, `create.tsx`,
  `account/index.tsx`) — destructure `access` from
  `usePrimaryLocationBillingGate` and pass `status={access.status}` (dashboard
  also adds `billingGateAccess.status` to the `listTop` useMemo deps).
- `supabase/functions/_shared/admin-alert-email.ts` (new) — Resend send via
  existing `RESEND_API_KEY`; destination `ADMIN_ALERT_EMAIL` defaulting to
  `support@twoferapp.com`; never throws, never logs the key or response body.
- `supabase/functions/submit-business-application/index.ts` — awaits
  `sendNewApplicationAdminAlert(...)` right after the insert's error guard, for
  every inserted application.
- Tests: `supabase/functions/_shared/admin-alert-email-source.test.ts` (new).

Task 3 (verify the approve→unblock loop) and Task 4 (optional `?email=` prefill
and "application received" card state) are NOT done — Task 4 needs Dan's call.

## Problem

When someone downloads the app and creates a **Business** account without first
registering on the website, the merchant gate blocks them with:

> **Business account not active** — Your business account is not active. Contact
> Twofer support to activate your business account.

with a single "Contact support" button. Three gaps:

1. **Dead end for the owner.** The card should route them to
   `https://www.twoferapp.com/business/start-trial` (the page that actually gets
   them a trial), with copy like "Verify your business" / "Start free trial".
2. **Dan can't easily turn on the trial** unless the person lands in the admin
   queue — which only happens after they submit the website application.
3. **No email alert to Dan** when a new application / pending verification
   arrives. He wants a Resend email (RESEND_API_KEY is already a Supabase
   secret and the send pattern is proven in
   `supabase/functions/_shared/approval-email.ts`).

## Current-state audit (verified 2026-07-10 — do NOT rebuild these)

- **Blocked card:** `components/merchant-access-blocked-card.tsx`, rendered in
  `app/(tabs)/dashboard.tsx` (~line 1250), `app/(tabs)/create.tsx` (~line 338),
  `app/(tabs)/account/index.tsx` (~line 1001), driven by
  `hooks/use-primary-location-billing-gate.ts` →
  `lib/merchant-access.ts` (`reason: "inactive_status"` whenever
  `summary.status` is not in the allowed set). The hook's `access.status` is
  available at every call site.
- **Billing statuses** (`lib/billing/entitlements.ts`): never-activated owners
  sit at `trial_eligible` / `trial_checkout_pending` (or a null/absent summary);
  everything else blocked is expired/suspended/canceled — a *different* audience
  that must NOT be told to "start a free trial".
- **Website page exists:** `website/business/start-trial/index.html` posts to
  the `submit-business-application` edge function. No `?email=` prefill support
  today.
- **Application intake exists:** `supabase/functions/submit-business-application/index.ts`
  scores the application, inserts into `business_applications`
  (status `trial_limited` auto / `review_required` / `pending_verification` /
  `waitlisted` / `rejected`), creates a `business_onboarding_requests` row, and
  rate-limits (3 per email / 8 per IP per 30 min). It sends **no email to Dan**.
- **Dan CAN already turn the trial on** once an application exists: the website
  admin (Trial requests tab / `website/admin/trial-requests.js` +
  `supabase/functions/admin-business-applications`) approves it, which sends the
  owner the trial-welcome email (`_shared/approval-email.ts`, deployed) and —
  critically — commit `9e3b1b55` (deployed to prod) makes
  `get-business-onboarding-context` reconcile the approval into
  `business_subscriptions` / `location_entitlements` on the owner's next app
  open **even if they signed in before approval**. That is exactly the
  app-first scenario this plan serves. Matching is **by email**, which drives a
  copy requirement below.
- **Resend pattern to copy:** `_shared/approval-email.ts` — never throws,
  returns warning string or null, idempotent, never logs the API key or
  provider response body. Source-test pattern:
  `_shared/approval-email-source.test.ts`.

## Task 1 — Rework the blocked card (app)

**File:** `components/merchant-access-blocked-card.tsx` + the 3 call sites +
`lib/legal-urls.ts` + `lib/i18n/locales/{en,es,ko}.json`.

1. Add to `lib/legal-urls.ts` (same override pattern as SUPPORT_URL):

   ```ts
   export const BUSINESS_START_TRIAL_URL =
     process.env.EXPO_PUBLIC_BUSINESS_START_TRIAL_URL ??
     "https://www.twoferapp.com/business/start-trial";
   ```

2. Give the card two variants, selected by a new prop. Pass
   `access.status` (from `usePrimaryLocationBillingGate`) and the signed-in
   email (session is already read in these screens or via the auth-session
   provider — `app/(tabs)/settings.tsx:756` shows the `session?.user?.email`
   pattern) from each of the 3 call sites:

   - **`needsTrial` variant** — when `status` is `null`, `trial_eligible`, or
     `trial_checkout_pending` (never activated). New copy (decision made —
     merges both of Dan's suggested phrasings):
     - Title: **"Verify your business"** (`merchantAccess.verifyTitle`)
     - Body (`merchantAccess.verifyBody`, i18next `{{email}}` interpolation):
       *"Your business account isn't active yet. Request your free trial and
       we'll review it within 1–2 business days. Apply with the same email you
       signed in with: {{email}}"*
     - Primary button (`merchantAccess.startTrialCta`): **"Start free trial"**
       → `openWebsiteUrl(BUSINESS_START_TRIAL_URL)`. Use the existing
       `PrimaryButton`-style component used elsewhere on these screens so the
       CTA reads as the main action (check what dashboard uses; if only
       `SecondaryButton` fits the card style, keep it but list it first).
     - Secondary button: keep the existing "Contact support" →
       `SUPPORT_URL`.
   - **default (inactive) variant** — every other blocked status
     (expired/suspended/canceled/payment-failed): keep today's
     `inactiveTitle`/`inactiveBody`/"Contact support" exactly as-is. Do not
     tell a suspended or expired business to start a free trial.

   The "same email" line is load-bearing: approval → app unblock matching is by
   email (`get-business-onboarding-context` reconcile). Without it, owners who
   apply with a different address stay stuck.

3. i18n: add the 3 new keys to `en.json`, `es.json`, `ko.json` under
   `merchantAccess`. Suggested translations (native-review not required for
   pilot, match existing tone):
   - es: `verifyTitle` "Verifica tu negocio"; `verifyBody` "Tu cuenta comercial
     aún no está activa. Solicita tu prueba gratis y la revisaremos en 1 o 2
     días hábiles. Usa el mismo correo con el que iniciaste sesión: {{email}}";
     `startTrialCta` "Comenzar prueba gratis".
   - ko: `verifyTitle` "비즈니스 인증하기"; `verifyBody` "비즈니스 계정이 아직
     활성화되지 않았습니다. 무료 체험을 신청하시면 영업일 기준 1~2일 내에
     검토해 드립니다. 로그인한 이메일을 그대로 사용해 주세요: {{email}}";
     `startTrialCta` "무료 체험 시작".
   - If `email` is somehow null, the body should gracefully omit the email
     sentence (separate key `merchantAccess.verifyBodyNoEmail` or conditional
     render of a second `<Text>` line — prefer the second line so translators
     get one string each).

4. Keep UI minimal (Dan's standing preference): no new card chrome, reuse
   `CardShell variant="muted"`, existing font sizes/spacing.

## Task 2 — Email Dan when a new application arrives (edge function)

**Files:** new `supabase/functions/_shared/admin-alert-email.ts`, new
`supabase/functions/_shared/admin-alert-email-source.test.ts`, edit
`supabase/functions/submit-business-application/index.ts`.

1. New shared module `sendNewApplicationAdminAlert(params)` mirroring the
   `approval-email.ts` contract exactly:
   - Never throws; returns `string | null` (warning surfaced only in logs here —
     the public endpoint response must not change shape).
   - Reads `RESEND_API_KEY` — **already set in Supabase secrets (confirmed by
     Dan 2026-07-10); do not create or rename it.** If it is missing at
     runtime, `console.error` + skip — never block the application insert.
   - Destination: optional secret **`ADMIN_ALERT_EMAIL`** (the inbox Dan wants
     pinged), defaulting to `support@twoferapp.com` when unset — so the feature
     works with zero new secrets, and Dan can point it at a personal inbox
     later without a code change.
   - From: `Twofer <support@twoferapp.com>` (same verified Resend domain).
   - Subject: `New business application (<status>) — <business name>`, e.g.
     `New business application (pending_verification) — Oak Cliff Coffee`.
   - Body (text + simple HTML, escape everything with the same `escapeHtml`
     approach): business name, contact name, applicant email, phone (if any),
     status / access tier / risk score, source (`website_start_trial`), and a
     fixed link to the admin dashboard trial-requests view
     (`https://www.twoferapp.com/admin`). No secrets, no tokens, no free-form
     long fields (slow hours / offer interests can be truncated to ~200 chars).
   - Never log the API key or the Resend response body (status code only).

2. Wire it into `submit-business-application/index.ts` immediately after the
   `business_applications` insert succeeds (after line ~353), `await`ed but
   best-effort. Send for **every** inserted application regardless of status —
   volume is pilot-tiny and Dan wants awareness; auto-`rejected` and
   `waitlisted` ones are still worth seeing. The honeypot early-return
   (`company_website`) and rate-limited requests never reach the insert, so
   they never email. The existing per-email/per-IP rate limits are the abuse
   cap for this public endpoint.

3. Tests: `_shared/admin-alert-email-source.test.ts` following
   `approval-email-source.test.ts` (vitest, reads source, asserts: Resend
   endpoint, `ADMIN_ALERT_EMAIL` env read, never-throw contract
   `Promise<string | null>`, no `response.text()`, no logging of the key, and
   that `submit-business-application/index.ts` calls it after the insert).

4. **No migration needed.** No new columns; per-insert send needs no
   idempotency flag (one insert = one email; a Resend failure just means no
   email, acceptable).

## Task 3 — Verify the "Dan turns on the trial" loop (no new code expected)

QA the end-to-end path on paper/code (and on device after rebuild):

1. App-first business signup (no website application) → blocked card shows
   `needsTrial` variant with the owner's email.
2. Tap "Start free trial" → website form → submit with same email →
   `business_applications` row created → **Dan receives the alert email**.
3. Dan approves in admin (Trial requests) → owner gets the trial-welcome email
   (existing) → owner reopens the app → `get-business-onboarding-context`
   reconcile (commit `9e3b1b55`, already live) flips
   `location_entitlements` → gate opens, card disappears.
4. Negative check: an expired/suspended business still sees the old
   "not active / contact support" card, not the trial CTA.

If step 3's reconcile misbehaves, that's a regression against `9e3b1b55` —
stop and report, don't patch around it.

## Task 4 (OPTIONAL — ask Dan before doing)

- **Email prefill on the website form:** support
  `/business/start-trial?email=...` by reading the query param in the page's
  inline script and prefilling the email input (client-side only, never
  logged), and have the app append the signed-in email to the URL. Tightens
  the same-email requirement to near-zero failure. Costs a website deploy
  (gated) and puts an email address in a URL — Dan's call.
- **"Application received" card state:** after the owner applies, the app
  still shows "Verify your business", which invites re-submission. A pending
  variant needs the application status exposed to the client (touches
  `get-business-onboarding-context` response + a client hook). Defer unless
  Dan asks; rate limiting makes duplicates mostly harmless.

## Validation

- `npm run typecheck`, `npm run lint`, `npm test` (includes the new source
  test).
- `npm run typecheck:functions`.
- No RLS, no migrations, no AI-poster-locked files touched.

## Deploy / rollout (each item Dan-gated per CLAUDE.md)

1. (Optional) Set Supabase secret `ADMIN_ALERT_EMAIL=<Dan's inbox>` if alerts
   should go somewhere other than the default `support@twoferapp.com` (Dan runs
   or approves; never print the value). `RESEND_API_KEY` is already set — no
   action.
2. ✅ DONE 2026-07-10 — deployed `submit-business-application` to prod
   (project `kvodhiqhdqnptqovovia`); new `_shared/admin-alert-email.ts` bundled
   in; endpoint verified live (empty POST → 400 "Missing required fields", no
   side effects). Note: the live email send itself is proven only by a
   throwaway real application submission (creates a prod row + emails the admin
   inbox) — Dan's QA step.
3. App rebuild for the card change (card is client code — NOT covered by the
   edge-function deploy).
4. Optional Task 4 website change → Vercel website deploy (gated).

Nothing here blocks anything else: the edge-function email can ship before the
app rebuild and vice versa.
