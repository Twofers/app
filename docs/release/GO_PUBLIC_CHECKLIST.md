# Go-Public Checklist (branch: release/apple-app-store-readiness-web-billing)

Last updated: 2026-07-22. **All 7 steps below are SHIPPED.** Twofer is live on
both stores and www.twoferapp.com links to both. This checklist is now history —
keep it for the record, do not work from it.

Earlier state (2026-07-02): steps 1-4 shipped — committed (7782b8c6), migrations
confirmed already applied, edge functions deployed, website live, branch pushed.

## Ready in the working tree (uncommitted)

- Admin dashboard live auth with server-enforced MFA (`require_mfa` → aal2 checked
  on every admin endpoint), login rate limiting (8 attempts / 15 min).
- Public trial form: client-side validation, rate limits (3/email, 8/IP per 30 min),
  no account-existence oracle, business/Stripe materialization deferred until the
  real owner signs in.
- Website security headers (nosniff, frame-deny, referrer, permissions policy)
  plus `X-Robots-Tag: noindex` on /admin/*, asset cache headers.
- Brand kit: favicon.ico + PNG icon set + apple-touch-icon generated from the
  penguin logo; social share card (`/assets/og-card.jpg`, 1200x630).
- Head metadata on all 28 pages: favicon links, theme-color, canonical, Open
  Graph + Twitter cards on public pages, `noindex` on admin/billing/flow pages.
- Self-hosted hero photos (Unsplash hotlinks removed); nav/footer now load a
  10 KB mark instead of the 362 KB master logo.
- robots.txt + sitemap.xml.
- versionCode 41 (Android) already bumped in app.json / build.gradle.
- **Live-launch copy**: all "DFW preview / testing / TestFlight" framing removed
  site-wide (en/es/ko) — homepage, trial page, business terms, thanks, waitlist
  pages now read as a live product, not a beta. Business CTAs read "Request
  Business Access" (approval-gated is still accurate and stays).
- **Store link switch** (both URLs now filled in — see step 5):
  `website/store-links.js` is the single place to set the real App Store / Play
  Store URLs (`TWOFER_STORE_LINKS.ios` / `.android`). A platform left `null`
  keeps its "Get Twofer for iPhone/Android" buttons hidden and shows a
  "Notify me when the app is ready" mailto fallback instead, so the site never
  links to a store page that doesn't exist yet. That hide-while-null behavior
  is why the iPhone buttons stayed invisible for a stretch after the iOS
  listing went live — the mechanism is working as designed, but it fails
  silent, so re-check the live site after any store launch.
- **Admin directory is fully wired**, not just Overview: Businesses, Offers,
  Billing Events, Audit Log, and Settings (launch areas / feature flags / admin
  users) now read live data from `admin-dashboard-summary` (new per-section
  reads, each one audited). Business Detail page shows a business's linked
  applications and audit history. All of it is read-only for now — moderation
  actions (pause offer, suspend business, etc.) are still "coming soon."
- **Founder field invite** (`/admin/businesses/new`) creates a real
  `business_applications` row and runs it through the exact same audited
  decision path as a normal trial-request approval (`applyDecision` — shared
  code, not a parallel one-off).
- New tests lock in the create-action contract and the per-tab admin reads
  (`business-application-source.test.ts`, `admin-dashboard-source.test.ts`).

Validation: typecheck, lint, full test suite (1117 tests), typecheck:functions,
website readiness script — all green. Verified visually in the browser: home
page hero/customer/FAQ sections in EN/ES/KO, store-link hide/show behavior
both ways, trial-form client validation, and every admin tab's unauthenticated
state (no console errors anywhere).

## How business → Stripe onboarding actually works (verified in code)

1. Admin approves a trial (Trial Requests page, or Businesses → New Trial for
   someone met in person) → `admin-business-applications` saves the audited
   decision and ensures there is a `business_onboarding_requests` row tied to
   the owner email. It does not scan Supabase Auth by email during the browser
   request.
2. The owner signs in to the app with the same email → `get-business-onboarding-context`
   materializes or links the `businesses` row, queues the Stripe customer sync
   job, and seeds the trial `business_subscriptions` row. No live Stripe
   customer exists yet at this point.
3. The moment the owner (or an admin) starts billing — `/business/billing/start`
   → `stripe-create-checkout-session` — that function passes a **real** Stripe
   client, so it creates the actual Stripe customer on demand and returns a
   Checkout URL. This is the real "get them to the Stripe info" moment; it
   doesn't depend on step 1's queued job.
4. Stripe webhooks (`stripe-webhook`) then keep `business_subscriptions` in sync
   with payment status.

Net: the path works end-to-end without any extra wiring. The one loose end is
that nothing currently drains the `stripe_sync_jobs` queue from step 1 — it's
inert unless step 3 happens anyway. Not a blocker (checkout doesn't need it),
but worth knowing if you ever expect that queue to pre-provision customers
before an owner starts checkout.

## Dan's gated actions, in order

1. ~~**Review + commit** this branch~~ — DONE, commit `7782b8c6` on
   `release/apple-app-store-readiness-web-billing`.
2. ~~**Apply 2 pending migrations**~~ — DONE. `supabase db push --dry-run`
   confirmed "Remote database is up to date" (both `20260730128000` and
   `20260730129000` were already applied). `node scripts/probe-rls-smoke.mjs`
   run as a safety check — all checks passed.
3. ~~**Deploy edge functions**~~ — DONE. Redeployed to guarantee production
   matches the committed code: `admin-auth-session`,
   `admin-business-applications`, `admin-ai-usage`, `admin-dashboard-summary`,
   `submit-business-application`, `get-business-onboarding-context`,
   `ai-compose-offer`, `ai-deal-suggestions`, `ai-generate-ad-variants`,
   `ai-generate-deal-copy`. Post-deploy check: `admin-dashboard-summary` and
   `admin-business-applications` both correctly return 401 unauthenticated.
4. ~~**Deploy the website**~~ — DONE. Live on www.twoferapp.com. Verified:
   favicon.ico (200), og-card.jpg (200), homepage shows "Live now in
   Dallas-Fort Worth" / "Request Business Access", `/admin/` returns
   `X-Robots-Tag: noindex, nofollow`.
   Branch pushed to `origin/release/apple-app-store-readiness-web-billing`
   (was never pushed before — upstream tracking now set).
5. ~~**Store URLs into the website**~~ — DONE 2026-07-22, commit `dc809e80`,
   Vercel prod `dpl_ECt34Jti8WNEoUYArxBytostoFpJ`. Android had been filled in
   earlier; `ios` was still `null`, which hid all four "Get Twofer for iPhone"
   CTAs (2 on `/`, 1 on `/s`, 1 on `/business/billing/checkout`). Set to the
   real App Store URL and bumped `store-links.js?v=` to `20260722-ios-live` on
   all three including pages. Also added an `apple-itunes-app` smart banner to
   `/` and `/s` and `MobileApplication` JSON-LD to `/`. Verified live: all four
   CTAs render with correct hrefs in en/es/ko, no console errors,
   `npm run check:website-ui` passes (37 routes, 2 viewports).
6. ~~**Build the app**~~ — DONE. Both store listings are live, so the builds
   shipped. NOTE: this step originally said "versionCode 41"; `app.json` now
   reads **49**, and the shipped Play build was not confirmed against that
   number during this update — check Play Console before assuming 49 is live.
7. ~~**Submit**~~ — DONE, both stores approved and public as of 2026-07-22:
   - iOS: "Twofer: Local deals on demand", app id `6765769303`, Free, 13+,
     iOS 15.1+, category **Shopping**, seller displayed as **Paul Sanders**.
   - Android: `com.unvmex2.twoforone`, public with an Install button, updated
     2026-07-14, category **Food & Drink**, developer displayed as **TWOFER**.

   The two listings disagree on category and on displayed developer name.
   Neither is a website bug; the seller name is editable in App Store Connect
   without resubmitting the app.

## Known-accepted / parked (not blockers)

- `ai_compose_quota_status` SQL shows a fixed limit of 30 (display only; the edge
  function enforces via `AI_MONTHLY_LIMIT`, default 30). Documented in the migration.
- `authUserByEmail` scans up to 20k users per lookup — fine at pilot scale.
- `stripe_sync_jobs` queue (see above) isn't drained by a worker — harmless today.
- Admin directory tabs are read-only; moderation/suspend/extend actions from the
  original spec still need dedicated audited edge functions before they ship.
- GitHub branch protection + pre-billing caveat (subscription-pricing.ts) parked
  from the 2026-06-17 security gate.
