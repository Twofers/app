# In-app business application (keep the QR → website path) — plan, 2026-07-23

**Status: PLAN ONLY. Nothing in this document is implemented. Approved scope so far ends at the pending-approval card shipped (uncommitted) on 2026-07-23.**

## Goal

1. Keep the QR-code handout flow exactly as it is: prospects scan → `twoferapp.com/business/start-trial` → website application form.
2. Add a second path: a business owner who found the app first (store download, word of mouth) can **apply inside the app** instead of being bounced to the browser.
3. Stripe stays out of the app. All payment/activation continues on the website (`/business/billing/start` + tokenized checkout). This plan touches no payment surface.

Both paths converge on the same pipeline Dan already reviews: `business_applications` → admin alert email (+ quick-approve link) → Trial Requests dashboard → approval email → web Stripe checkout.

## Verified current-state facts (read-only audit, 2026-07-23)

- The website form posts to the **public** edge function `submit-business-application` (`verify_jwt = false` in `supabase/config.toml`). It already has: honeypot (`company_website`), rate limits (3/email + 8/IP per 30 min, 40-per-window admin-alert flood ceiling), risk scoring, admin alert email, quick-approval token mint, `business_onboarding_requests` ledger row, and a Stripe customer-sync enqueue. Inserts `business_applications` with `source: "website_start_trial"`.
- **Scoring trap that shapes the in-app form:** missing address = −30; an address/launch area that doesn't match the DFW keyword list ⇒ immediate `waitlisted`. Score ≥ 70 ⇒ `pending_review` + quick-approve eligible; 40–69 ⇒ `review_required`; else `pending_verification`. An in-app form that skips address would silently waitlist every applicant — so the form must collect address (and hint the DFW pilot).
- The app's authed context fn `get-business-onboarding-context` atomically claims **exactly one approved application** by the confirmed session email (`claim_approved_business_application_for_user` RPC) and materializes the business. When there is nothing to claim it returns `business: null` with `access_state.reason_code = "approval_required"` and **no information about whether a pending application exists** — that's why the app can't currently say "application received."
- `business_applications.source` is free text (`DEFAULT 'website_business'`, no CHECK) ⇒ a new source value needs **no migration**. Status CHECK already includes `waitlisted`, `rejected`, `suspended`, `expired`, `archived`, plus the pending and approved tiers.
- The businesses INSERT gate (migration 20260814130000) intentionally lets rejected/archived applicants re-apply (those rows don't count toward the per-owner cap).
- App side today (uncommitted work from this session): unapproved business owners see the pending-approval card with "Apply on the website" (`BUSINESS_APPLY_URL = /business/start-trial`), "Check approval status", contact support, log out; the card re-checks on app foreground.
- Stripe/billing: `purchase_surface = web_only`; every mobile billing flag in `lib/billing/access.ts` returns false. Nothing here changes that.

## Work items

### WI-1 — Server: expose the applicant's own application status (deploy-gated)
File: `supabase/functions/get-business-onboarding-context/index.ts`

In the `business: null` branch, add a service-role read of the newest `business_applications` row for the session email and return:

```
application: { status: "none" | "pending" | "waitlisted" | "rejected", submitted_at: string | null }
```

Mapping: `pending_review` / `pending_verification` / `review_required` → `pending`; `waitlisted` → `waitlisted`; `rejected` → `rejected`; approved tiers (`trial_limited`, `trial_active`, `approved_not_billed`, `active`) normally never reach this branch (the claim would have materialized) — return `pending` so the next recheck resolves it; `suspended` / `expired` / `archived` → `none` (re-apply is the intended path per the INSERT-gate design). No enumeration risk: the caller has already proven ownership of that email (confirmed session), unlike the public submit endpoint which deliberately echoes nothing.

### WI-2 — Server: tag in-app submissions (deploy-gated, small)
File: `supabase/functions/submit-business-application/index.ts`

- Accept optional `source`, allowlisted to `{"website_start_trial" (default), "app_business_setup"}`; write it to the insert and the admin alert so Dan can see where each application came from. Website keeps working unchanged (omits the field → default).
- Hardening (recommended): when a valid `Authorization` JWT accompanies the request, override the payload email with the token's confirmed email so the in-app path can't submit for someone else's address. Website calls (no JWT) behave exactly as today.

### WI-3 — App: in-app application screen
New file: `app/business-apply.tsx` (stack screen, business role only)

- Email: prefilled from the session and **locked** (it's the join key the claim RPC uses).
- Fields mirroring the website form: business name*, contact name*, street address* (with "we're piloting in Dallas–Fort Worth" hint so out-of-area folks understand the waitlist), phone, business type, website or Instagram (optional — these are the score boosters that reach the ≥70 quick-approve tier).
- Required checkboxes: terms accepted + privacy acknowledged (reuse `LegalExternalLinks`); optional promo-materials authorization checkbox (same optional-never-gating treatment as business setup).
- Submit → `submit-business-application` with `source: "app_business_setup"`; on success, return to the pending card in its "under review" state (bump the existing recheck nonce). Localized en/es/ko.

### WI-4 — App: pending card becomes status-aware
File: `app/business-setup.tsx` (pending-approval view built this session)

Drive the card off WI-1's `application.status`:
- `none` → "Apply now" (opens WI-3) as primary; the website path stays available as secondary (decision point 1).
- `pending` → "Application received — under review" + submitted date + "Check approval status"; hide the apply button so people don't double-submit.
- `waitlisted` → honest waitlist copy (outside the pilot area) + contact support.
- `rejected` → "not approved" copy + contact support (decision point 2).
Approval itself needs no new handling — the existing recheck already flips the screen into setup once the claim materializes the business.

### WI-5 — Tests & validation
- Source-contract tests for both fn changes (same style as `approved-activation-gate-source.test.ts` / `admin-alert-email-source.test.ts`).
- i18n: new keys in en/es/ko; `npm run check:i18n-keys` parity.
- Baseline gates: `npm run typecheck`, `npm run typecheck:functions`, `npm run lint`, `npm test`.
- Device QA after a rebuild: fresh business account → apply in-app → admin email arrives tagged `app_business_setup` → card shows "under review" → approve → foreground recheck opens setup.

## What does NOT change

- Website form, QR handouts, admin dashboard, quick-approve email, approval email + tokenized web checkout, `claim_approved_business_application_for_user`, Stripe web-only surface, RLS. No migration.

## Deploy gates (Dan)

1. Deploy `get-business-onboarding-context` (WI-1).
2. Deploy `submit-business-application` (WI-2).
3. App rebuild for WI-3/WI-4.

## Decision points for Dan

1. On the card when no application exists: show both "Apply now" (in-app) and "Apply on the website," or in-app only? Recommendation: in-app primary, website demoted to small text — QR-handout users never see this screen anyway.
2. Rejected state: contact-support only (recommended), or also allow re-applying from the app?
3. JWT-email hardening in WI-2: recommended yes.
4. Include the optional score-booster fields (business type, website/Instagram) in the in-app form: recommended yes.

## Risks / notes

- Duplicate applications (same email on both surfaces): tolerated by design — rate limit caps at 3 per 30 min, admin sees both, the claim RPC claims exactly one approved application, and the status read uses the newest row.
- No new public attack surface: the app reuses the existing public fn with its existing limits; WI-1 only reveals a user's own application status.
- Apple review: the in-app form collects an application, not payment; the app already links out for activation today. No change to `purchase_surface`.
- In-app applicants inherit the DFW scoring — out-of-area users get waitlisted exactly like the website, but now the card says so instead of leaving them confused.

## Alternatives (if Dan prefers different scope)

- **Option B — smaller:** skip the in-app form entirely (drop WI-2/WI-3). Build only WI-1 + WI-4: the card gains real "under review / waitlisted / rejected" states while applying stays on the website. Roughly half the work; still fixes the worst confusion ("I already applied but it still says Apply").
- **Option C — bigger, later:** a full in-app onboarding wizard (application + site import + profile in one flow). Not recommended now; revisit after the pilot proves the two-path funnel.
