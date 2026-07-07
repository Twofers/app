# Business sign-up + admin refresh plan (2026-07-06)

## Audit summary

- The website is static HTML/CSS/JS under `website/`, deployed on Vercel. Shared design system in `website/styles.css`, localization (EN/ES/KO) in `website/localization.js` with EN fallback.
- The business account sign-up page is `website/business/start-trial/` (`/business` redirects to it). It POSTs to the `submit-business-application` edge function, which validates, rate-limits, risk-scores, inserts into `business_applications`, creates a `business_onboarding_requests` row, and enqueues a Stripe customer sync. It intentionally never materializes a business or leaks account existence from this public endpoint. No acknowledgment email is sent automatically.
- Admin (`website/admin/`) is already a working command center: overview with next actions/North Star/business health (`admin.js` + `admin-dashboard-summary`), trial-requests queue with approve limited/full, waitlist, reject, AI review (`trial-requests.js` + `admin-business-applications`), businesses directory/detail, offers, billing events, audit log. Admin functions verify `admin_users` membership + optional MFA and fail closed (401/403), with audit logging.
- Data flow verified in source: every sign-up form field is inserted and returned by the admin list endpoint.

Gaps found:

1. Sign-up page is functional but visually thin vs the landing page (no dark brand hero, sparse value/trust content, no "what happens next", no required-field markers, single generic error line, no distinct rate-limit message, submit button not disabled during submit).
2. Success page `/business/thanks` is nearly empty ("Thanks."). Waitlist and review-pending pages are bare.
3. Admin dashboard triage links pass `?status=` / `?risk=high` to `/admin/trial-requests`, but that page ignores URL params (loads default queue).
4. Trial-requests detail row omits submitted `phone` and `website_or_instagram` (returned by the API but never displayed).
5. Admin overview "Recent applications" table shows raw enum values (`trial_limited`) with no humanization and rows are not linked.
6. Admin overview repeats past-due/missing-customer metrics in two sections.

## Changes

Frontend only. No edge function, schema, or RLS changes are needed; no new secrets required. No deploys performed (hard-gated).

1. `website/business/start-trial/index.html` — dark brand hero matching the landing page, value cards, restructured form with required markers and optional labels, field-level validation highlighting, submitting state, clean 429 vs generic errors, "what happens after you submit" steps, trust footer. Form field names and endpoint unchanged.
2. `website/business/thanks/index.html` — professional confirmation: what was received, review window, next steps (same-email sign-in), support link. No claim of automated email.
3. `website/business/waitlist/index.html`, `website/business/review-pending/index.html` — copy/structure polish consistent with the flow.
4. `website/localization.js` — new/updated EN keys with ES and KO translations.
5. `website/styles.css` — additive styles for the sign-up hero band, step list, required markers, invalid-field state, confirmation cards.
6. `website/admin/trial-requests.js` — honor `?status=` and `?risk=high` URL params (high risk mirrors the summary definition: risk_score <= 39 and open statuses); show phone + website/Instagram in the detail row.
7. `website/admin/admin.js` — humanize status/access labels in the recent-applications table and link rows to the queue.
8. `website/admin/index.html` — de-duplicate billing metrics between "Dashboard metrics" and "Billing & spend watchlist".

## QA checklist

- `node --check` on all modified JS.
- Serve `website/` locally; browser-inspect landing, sign-up (desktop + mobile widths), thanks, admin overview, trial-requests.
- Validation errors show per-field; submit path tested against a stubbed fetch (no real submissions to production).
- Admin pages unauthenticated: show "sign in" states, no data.
- EN/ES/KO switcher renders new keys.

## Risks and mitigations

- Risk: breaking the live form contract → field names, endpoint, honeypot, and payload shape are unchanged; only presentation and client validation change.
- Risk: admin JS regressions → changes are additive and small; unauthenticated behavior unchanged.
- Mobile app is untouched; no Supabase changes; production behavior unchanged until Dan deploys the website.
