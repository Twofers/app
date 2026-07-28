# Admin operations console redesign — implementation plan (2026-07-27)

Status: COMPLETE LOCALLY — Phases 0–8 implemented and checked off; no deploys or hosted migrations applied. Local and automated validation is recorded below, with hosted admin-session QA still required before deployment.

Goal (from Dan's design brief): rebuild the admin web pages as a **service and
operations console for one owner** — "show what needs attention, let me fix it
quickly, and make it easy to see whether businesses, offers, redemptions,
users, and AI costs are working." Three working tools anchor everything:
**business setup, activity review, and account repair.**

---

## 1. Ground truth (read-only audit, 2026-07-27)

- The admin site is static hand-written HTML/JS under `website/admin/` (20 HTML
  pages), no framework, no build step. Styling lives in `website/styles.css`
  scoped under `.admin-shell` (from ~line 3250). English-only — zero `data-i18n`
  on admin pages, and that stays acceptable (admin is internal).
- `/admin` is a minimal signed-out shell; `admin.js` injects `app.html` when a
  stored token exists (audit F-015 pattern). Keep this pattern.
- The nav (14 links) is hand-copied into all 20 HTML files, and the Supabase
  functions URL is hardcoded 50+ times as `data-*-endpoint` attributes. This is
  the biggest mechanical obstacle to any redesign and must be fixed first.
- The read model is `admin-dashboard-summary` (1,624 lines): overview KPIs
  (businesses/trialRequests/offers/activity/billing/security/apiSpend/
  prospects/moderation), `businessHealth` rows (rich per-business signals:
  live offers, claims/redemptions 7d+30d, claim-to-redemption rate, trial days,
  AI quota risk, `health_label`, `primary_reason`, `reason_codes`,
  `attention_score`, `suggested_read_only_action`), capped at 50 rows, plus
  `section:` sub-queries backing the directory pages and a `business_detail`
  drilldown.
- What exists that the brief needs: rules-based health signals (already rules,
  not AI ✅), Resend email plumbing (`_shared/approval-email.ts` — approval
  emails only), append-only `admin_audit_log` via `audit()` in
  `_shared/admin-prospects.ts`, role gates (`requireAdmin`, per-role
  permissions), account lifecycle console (`admin-account-management`:
  list/detail/update_profile/suspend/reactivate/archive/permanent_delete),
  `resend_billing_link`, AI quota lookup/reset, `app_analytics_events` with
  `app_opened` / `deal_viewed` / `deal_claimed` / `deal_redeemed` (supports the
  proposed active-user definition exactly).
- What does NOT exist (greenfield): impersonation / "view as owner" (any
  layer), generic owner email, password-reset / resend-verification / MFA-reset
  / unlock / extend-trial admin actions, queue item statuses
  (New/Reviewing/Waiting/Resolved/Dismissed), onboarding checklist rollup,
  per-deal AI cost metric, communications history.

Conflict report (docs vs code): none material — the brief's assumption that
"Business Health" is separate from "Today's Next Actions" matches the current
`app.html`; both are fed by the same summary call, so unifying them is a
front-end + summary-shape change, not a data-model change.

---

## 2. Decisions embedded in this plan (Dan can veto any)

| # | Decision | Recommendation and why |
|---|---|---|
| D1 | "View as business owner" | Ship a **read-only owner preview** (renders the owner's businesses/offers/claims exactly as the owner-facing data would look, via a new summary section) — NOT real session impersonation. True impersonation mints owner-scoped tokens, touches auth, and is a large security surface for a one-owner tool. Revisit only if the preview proves insufficient. |
| D2 | Queue status persistence | New table `admin_queue_item_status` keyed by a deterministic issue key (e.g. `no_redemptions:<business_id>`), NOT per-row copies of derived issues. Issues stay computed by rules each load; the table only overlays status/dismissals/notes. Auto-clears when the underlying condition resolves. |
| D3 | Owner email sending | New edge function `admin-owner-email` using the existing Resend pattern. AI drafts via the existing `_shared/admin-ai.ts` + `admin-ai-prompts` registry; **send always requires explicit admin review + click** (never auto-send), matching the brief. |
| D4 | Active-user definition | "Distinct consumer with an `app_opened`, `deal_viewed`, `deal_claimed`, or `deal_redeemed` event in `app_analytics_events` in the last 30 days, excluding business-role users." The card states this definition verbatim. |
| D5 | Prospects / Sales AI / QR campaigns | Keep the pages, move them out of primary nav into **Advanced** (brief doesn't mention them; they're sales tooling, not daily ops). No page deletions. |
| D6 | Navigation | Left sidebar on desktop, bottom bar on mobile, per the brief's grouping (Overview / Operations / Support / Finance & AI / Advanced). Rendered by shared JS so it lives in ONE file. |
| D7 | Framework | Stay static HTML/JS, no framework, no build step. The redesign is achievable with the existing pattern plus shared modules; introducing a bundler would break the website conventions and checklist. |
| D8 | Add business | "Add business" header button and "Set up a business" action both point at the existing `/admin/businesses/new` flow (admin-created application), upgraded into the onboarding checklist page in Phase 4. |

---

## 3. Phasing overview

Each phase is independently shippable and Dan-gated at its deploy step.
Front-end-only phases need only a website deploy; phases marked **[FN]** need
edge-function deploys; **[MIG]** need a migration (both hard-gated).

| Phase | What ships | Backend |
|---|---|---|
| 0 | Shared shell: one nav, one endpoint config, one session module | — |
| 1 | New dashboard layout from EXISTING summary data | — |
| 2 | Summary v2: 5 metric cards' real numbers, alerts, unified queue feed, recent deals, onboarding rollup | [FN] |
| 3 | Queue statuses + dismissals | [FN][MIG] |
| 4 | Business setup panel + guided onboarding page | [FN] |
| 5 | Account repair center | [FN] |
| 6 | AI-assisted owner email | [FN][MIG] |
| 7 | Read-only "View as owner" | [FN] |
| 8 | Nav/mobile polish, remove-from-main-page cleanup, deep links | — |

---

## 4. Phase 0 — Foundation: shared admin shell (prerequisite for everything)

Problem: nav ×20 files, endpoint URLs ×50+, session logic duplicated across
`admin.js`, `admin-directory.js`, `accounts.js`, `prospects.js`, etc.

- [x] New `website/admin/admin-shell.js` (single IIFE, no deps), exposing
      `window.TwoferAdminShell` with:
      - `SUPABASE_FN_BASE` constant (ONE place for the project URL) and
        `endpoint(name)` helper. Page HTML keeps only page-specific config.
      - Session helpers extracted from `admin.js` (token storage, silent
        refresh via `admin-auth-session`, `adminPost(fnName, body)` with the
        20s abort + 401→login behavior, sign-out).
      - `renderNav(current)` — injects the sidebar (desktop) / bottom bar
        (mobile) from one nav model implementing the brief's grouping:
        Overview (Dashboard, Action Queue) · Operations (Businesses, Offers,
        Redemptions, Customers, Reports) · Support (Account Repair,
        Communications) · Finance & AI (Billing, AI Usage) · Advanced
        (Business Access, Prospects, Sales AI, QR Campaigns, Prompts,
        AI Report, Audit Log, Settings, System Health).
      - Nav injection happens ONLY after a stored token exists, preserving the
        F-015 "no internal IA when signed out" property on every page (an
        improvement: today section pages ship their nav statically).
- [x] Migrate all 20 pages to include `admin-shell.js?v=…` and drop the copied
      `<nav>` blocks and duplicated endpoint attributes. Mechanical, large
      diff, zero behavior change — ship alone so review is easy.
- [x] New CSS in `styles.css` under `.admin-shell`: sidebar layout
      (`.admin-sidebar`, `.admin-layout` grid), bottom nav
      (`.admin-bottom-nav`, ≥48px touch targets), and a `.admin-side-panel`
      (slide-over) primitive used later by deal detail and email drafting.
      Bump `?v=` on all 40 including pages per the cache-bust rule.
- [x] Existing per-page JS keeps working: `admin-directory.js` etc. call
      shell helpers instead of their local copies (thin refactor, not a
      rewrite).

Validation: `npm run check:website-ui`, `npm run test:e2e`, visual pass on
every admin route desktop + 375px, confirm signed-out `/admin/*` pages show no
nav. No new routes yet.

## 5. Phase 1 — Dashboard restructure on existing data (front-end only)

Rewrite `website/admin/app.html` + the dashboard half of `admin.js`:

- [x] **Compact header**: "Twofer Admin — Operations overview for <date>";
      right side: search field (routes to Fix Account search once Phase 5
      exists; until then, to `/admin/accounts?q=`), persistent **Add business**
      button → `/admin/businesses/new`, sign-out/profile. (Notifications and
      view-as land in later phases; leave slots.)
- [x] **Three top actions**: Set up a business → `/admin/businesses/new`;
      Review offers and redemptions → activity panel anchor / `/admin/offers`;
      Fix an account → `/admin/accounts` (later `/admin/account-repair`).
- [x] **Service alerts**: render only-when-nonempty from existing
      `businessHealth` rows where `health_label = needs_attention` — each
      already carries `primary_reason`, `reason_codes`, and
      `suggested_read_only_action`. Map `reason_codes` to plain-English
      explanation + "why it matters" + recommended action via a client-side
      copy table (rules-first, per the brief; AI rewriting is NOT in v1).
- [x] **Five metric cards** with what exists today, upgraded in Phase 2:
      Deals created (live count exists; created today/7d = Phase 2) ·
      Redemptions (today + claim-to-redeem rate exist; 7d = Phase 2) ·
      Active users (Phase 2; interim: "new customers this week") ·
      Active businesses (active count exists; "with a live offer" = Phase 2) ·
      AI spend (this month, prior month exist; per-deal cost = Phase 2).
      Every card links to its detail page. Zero-value cards render muted, not
      hidden mid-phase (full "hide empty" polish in Phase 8).
- [x] **Unified action queue** replacing "Today's Next Actions" + "Business
      Owner Service" + "Business Health": one table (mobile: cards) merging
      (a) `businessHealth` rows and (b) the count-based queues (open trial
      requests, pending verification, failed billing events, open reports,
      offers needing review) as queue rows with category filters
      (All / New business setup / Offers / Redemptions / Accounts / Billing /
      AI usage / Customer reports). Sort: `attention_score` desc, then age.
      Status chips are static "New" until Phase 3.
- [x] **Recent deal activity panel**: from the summary `offers` section data;
      click opens the `.admin-side-panel` with the business_detail offer
      drilldown (already returned by `section: "business_detail"`).
- [x] **Removals from the main page** (per brief): audit table → link only;
      AI quota lookup/reset form → moves to `/admin/ai-usage` page (rename of
      current AI surfaces, Phase 8); billing watchlist + metrics `<details>`
      panels → deleted (all reachable via cards/queue); raw event names
      (`admin_mfa_verified` etc.) stay in the audit log page only.

Validation: check:website-ui (update mocked-endpoint fixtures for the new DOM),
test:e2e, manual pass with a real admin session BEFORE deploy (Dan-gated).

## 6. Phase 2 — `admin-dashboard-summary` v2 **[FN]**

Extend the overview payload (additive — old fields stay so the deploy can't
strand a cached front-end):

- [x] `summary.deals`: `createdToday`, `created7d`, `liveNow` (from `deals`).
- [x] `summary.redemptions`: `today`, `last7d`, `claimToRedeemRate30d`
      (from `admin_redemption_facts_v1` + `deal_claims` — same sources the
      health rows already query; reuse, don't re-implement).
- [x] `summary.users.active30d` per D4, from `app_analytics_events`
      (distinct consumer user_ids, role-filtered via `profiles`). Include
      `definition` string in the payload so the card copy can't drift.
- [x] `summary.businesses.withLiveOffer` (distinct business ids over live
      deals — already computed for health rows; surface the count).
- [x] `summary.apiSpend.perGeneratedDealUsd` = month AI cost / month deals
      created (guard div-by-zero), + `budgetMonthlyUsd` read from an optional
      admin setting (null → card omits budget line).
- [x] `queue` array: server-side union of health rows + count-queues as
      normalized items `{key, category, priority, business_id, business_name,
      title, explanation, waiting_since, recommended_action, links}` so the
      front-end stops merging heterogeneous shapes. Keep the 50-row health cap
      but ADD `businessHealthTotal` so truncation is visible ("showing 50 of
      N"), per the no-silent-caps rule.
- [x] `recentDeals` array for the activity panel: business, offer line,
      status (draft/scheduled/live/sold_out/expired/paused/needs_review —
      derived from existing deal fields), claims, redemptions, expires,
      anomaly flags (claims-no-redemptions, redemptions>quantity, no live
      offer) — computed from data already loaded for health rows.
- [x] Tests: extend the function's source tests; `npm run typecheck:functions`.

Deploy: `admin-dashboard-summary` only (Dan-gated). Front-end: swap interim
card values to the new fields, wire queue/recentDeals to the server shapes.

## 7. Phase 3 — Queue statuses **[FN][MIG]**

- [x] Migration: `admin_queue_item_status` (`issue_key text pk`, `status`
      enum-check (new/reviewing/waiting_owner/resolved/dismissed), `note`,
      `updated_by`, `updated_at`). RLS: no client access (service-role only via
      edge fn) — follow the RESTRICTIVE-policy + `COALESCE(...,false)` rule;
      run `node scripts/probe-rls-smoke.mjs` after applying.
- [x] `admin-dashboard-summary`: left-join statuses onto `queue` items;
      new `section: "queue_status"` action (or small dedicated fn) to set
      status/note, writing `admin_audit_log` (`admin_queue_status_set`).
      Resolved/dismissed items drop out of the default view but remain
      filterable; status rows for issues whose condition cleared are ignored
      (and can be lazily purged).
- [x] Front-end: status dropdown per queue row; "Dismiss" on service alerts
      writes `dismissed`.

## 8. Phase 4 — Business setup panel + guided onboarding **[FN]**

- [x] `admin-dashboard-summary` v2.1: `onboarding` array — for each business
      in setup (application approved but not fully live), a checklist computed
      from existing data: application approved (`business_applications`),
      owner email verified (GoTrue `email_confirmed_at`), business info
      complete (required `businesses` fields), terms accepted, trial activated
      (`trial_ends_at`/access status), billing confirmed
      (`business_subscriptions`/Stripe customer), first offer created / first
      offer published (`deals`), redemption tested (any redemption row).
      Plus `completed_count/total`.
- [x] Dashboard panel: businesses in setup with "N of 9 steps" progress;
      buttons Continue setup / Contact owner (Phase 6) / Resend verification
      (Phase 5) / Resend billing link (exists today —
      `admin-business-applications.resend_billing_link`).
- [x] Upgrade `/admin/businesses/new` + `businesses/detail` into the guided
      flow: detail page shows the same checklist (data via `business_detail`
      section so numbers can't diverge).

## 9. Phase 5 — Account repair center **[FN] + new route**

New page `/admin/account-repair` (route: vercel.json `/admin/account-repair`
+ trailing-slash rewrite, ROUTES entry in `scripts/check-website-ui-crawl.js`,
noindex header — matches existing `/admin(.*)` header rule, verify it covers
the new path).

- [x] Search across business name / owner+customer email / phone / business
      id / user id / redemption code → extend `admin-account-management.list`
      or add a `search` action joining `businesses`, `profiles`, redemption
      codes.
- [x] Account summary panel: reuse `admin-account-management.detail` +
      surface email-confirmed, last sign-in, MFA factors, suspension, trial &
      subscription status, recent audit entries (all available server-side).
- [x] New actions in `admin-account-management` (each: role-gated, reason
      required, audited, GoTrue admin API where relevant):
      - `send_password_reset` (admin `generateLink({type:"recovery"})` → send
        via Resend using the approval-email pattern; never surface the raw
        link in the UI).
      - `resend_verification` (`generateLink({type:"signup"})` / invite).
      - `reset_mfa` (delete the user's TOTP factors) — confirmation + reason.
      - `correct_email` (`auth.admin.updateUserById`) — confirmation + reason;
        WARNING in UI: merchant claim matches on application email, so
        changing an owner email interacts with the claim rule — show that
        caveat inline.
      - `extend_trial` (update `trial_ends_at` on the location entitlement /
        subscription row — reuse the write path of
        `admin-trial-create-from-prospect`, do not invent a second one).
      - `unlock` — only if a concrete lock exists for the account type
        (owner-side redemption lockout via `staff-redemption-lockout`
        semantics); otherwise omit the button rather than fake it.
      - Suspend/restore already exist — surface them here too.
- [x] Dangerous actions (correct_email, reset_mfa, suspend) require typed
      confirmation + reason, mirroring the existing ARCHIVE/DELETE pattern in
      `accounts.js`.
- [x] `/admin/accounts` remains as the directory ("Customers" in nav);
      Account Repair is the fix-it surface.

## 10. Phase 6 — AI-assisted owner email **[FN][MIG] + Communications page**

- [x] Migration: `admin_owner_communications` (`id`, `business_id`, `user_id`,
      `admin_user_id`, `reason_category`, `subject`, `body`, `status`
      draft/sent, `sent_at`, `created_at`). Service-role-only RLS; probe after
      applying.
- [x] New fn `admin-owner-email` — actions:
      - `draft`: input `{business_id, reason_category, tone_hints}`; server
        gathers ONLY verified facts (business name, owner name/email, detected
        issue from health signals, offer status, trial/billing status,
        recommended next step) and calls the AI with a prompt from the
        `admin-ai-prompts` registry that forbids inventing facts or promising
        account changes. Returns subject+body. Deterministic template fallback
        per category if AI fails (matches the AI-fallback house rule).
      - `refine`: shorter / friendlier / add-support-link / regenerate.
      - `save_draft`, `send`: send posts to Resend (from
        `Twofer <support@twoferapp.com>`), writes the communications row and
        `admin_audit_log` (`admin_owner_email_sent`). **`send` only ever fires
        from an explicit admin click after preview — enforce server-side that
        the payload is the reviewed subject/body, not a draft id alone.**
      - Provider failures return sanitized errors (house rule: never leak raw
        upstream bodies).
- [x] Front-end: "Draft email" buttons on alerts / queue rows / onboarding
      panel / account repair open the side panel with the 3-step flow
      (reason → draft → review/edit/send). Editable subject+body, regenerate,
      save-without-sending.
- [x] New page `/admin/communications`: list from `admin_owner_communications`
      (+ per-business history shown on `businesses/detail`). Route + ROUTES +
      rewrites + noindex.
- [x] Note: AI drafting cost goes through the shared AI provider config —
      confirm which key/quota it bills to before deploy (prepaid-key fallback
      chain applies).

## 11. Phase 7 — Read-only "View as owner" **[FN]** (per D1)

- [x] `admin-dashboard-summary` new `section: "owner_view"`:
      `{business_id}` → the owner-facing picture assembled server-side with
      service role (their businesses, live/scheduled offers as the app orders
      them, claim/redemption states, trial/billing banners the owner would
      see). No owner tokens are ever minted.
- [x] Front-end: "View as owner" from queue rows / business detail / account
      repair renders that data in an owner-styled panel with the persistent
      banner "Viewing as <business> — Exit owner view" (banner is sticky,
      visually loud, and the admin chrome is suppressed while active, per the
      brief's wrong-account-safety goal).
- [x] Every entry audits `admin_owner_view_opened`.
- [x] True impersonation: explicitly out of scope; revisit only on Dan's ask.

## 12. Phase 8 — Nav/mobile polish + cleanup

- [x] Finalize nav per D5/D6; "Offers" page gains a "Redemptions" sibling view
      (filtered directory over redemption facts — summary `section:
      "redemptions"` if the current offers section can't carry it).
- [x] Rename surfaces: current "Business Access" (trial-requests) moves under
      Advanced label "Business Access"; "Accounts" nav label becomes
      "Customers"; AI surfaces consolidate under "AI Usage" (ai-operating-
      report + quota tools) with Prompts under Advanced.
- [x] Mobile: bottom nav (Home / Businesses / Offers / Fix Account / More),
      all queue/deal tables render as cards (extend the existing
      `data-mobile-cards` pattern), buttons sized for standing-in-a-shop use.
- [x] Hide empty/zero sections on the dashboard (alerts already
      only-when-nonempty; apply to onboarding + queue).
- [x] Sweep: no raw enum/event names on operational pages
      (`humanizeEnum` everywhere user-visible).

---

## 13. Validation matrix (every phase)

- Baseline website: `npm run check:website-ui` (update its mocked admin
  fixtures per phase — it mocks admin endpoints, so new DOM/endpoints need
  fixture updates or it fails), `npm run test:e2e`.
- Endpoint config changes: `npm run check:website-supabase`.
- Cache-bust: bump `?v=` on EVERY page including any edited shared file
  (`styles.css` ×40, new `admin-shell.js` ×20) and run the uniq-count grep
  from `docs/website-edit-checklist.md` §3.
- Edge functions: `npm run typecheck:functions` + focused source tests; CI
  also runs `gate:release-state` — a new fn or migration stales generated
  state, so re-run `npm run release:state` in the same change.
- Migrations (Phases 3, 6): Dan-gated apply; `supabase migration list` before
  and after; `node scripts/probe-rls-smoke.mjs` immediately after (both new
  tables carry RLS).
- New routes (account-repair, communications, action-queue if it gets its own
  page): vercel.json rewrites ×2 each, ROUTES in
  `scripts/check-website-ui-crawl.js`, noindex verified, NOT in sitemap.
- No admin i18n required (admin is sanctioned English-only), but
  `check:website-i18n` must still pass repo-wide.
- Deploys: website via `npx vercel deploy --prod --yes` FROM `website/`;
  functions via CLI from the repo — every deploy is a hard gate on Dan's go.

### Local validation record (2026-07-28)

- Passed: `npm run typecheck`, `npm run lint`,
  `npm run typecheck:functions`, `npm run check:website-ui` (42 routes across
  desktop and mobile), `npm run test:e2e`, `npm run check:website-supabase`,
  `npm run check:website-i18n`, `npm run copy:evaluate`, and
  `npm run gate:release-state`.
- Passed: focused admin dashboard, account-management, owner-email,
  business-application, QR-campaign, and prompt-registry source tests.
- Full `npm test`: 2,112 passed and one unrelated existing assertion failed in
  `lib/business-name-change.test.ts`. That assertion calls suspended, disabled,
  and archived post-approval/locked while the current shared TypeScript and
  SQL-backed source-of-truth list classifies them as non-public/unlocked.
- Verified cache-bust coverage: 44 HTML pages reference the current shared
  stylesheet version and all 22 admin HTML pages reference the current shared
  shell version.
- Not run: hosted migration/function checks, real admin-session QA, email
  delivery, and owner-view verification against hosted data. Those require
  approved hosted changes or Dan-controlled accounts.

## 14. Risks / watch-outs

1. **Phase 0 diff size**: touching all 20 admin pages + styles.css in one
   change. Mitigate: behavior-identical refactor, shipped and verified alone.
2. **check:website-ui fixtures**: the crawl mocks admin endpoints; the new
   dashboard shapes (queue, recentDeals, onboarding) must be added to mocks or
   the always-run check breaks for every future website edit.
3. **GoTrue admin APIs** (Phase 5) are powerful — every new action must be
   role-gated, reasoned, audited, and never echo links/tokens to the client.
4. **Email sending** (Phases 5–6) uses production Resend + real owners —
   test paths must target Dan-controlled addresses; no test sends to real
   merchants without approval.
5. **Summary payload growth**: v2 adds queue/recentDeals/onboarding to an
   already 7-query function. Keep the existing parallel-query +
   degrade-gracefully pattern (per-section error fields, never fail the whole
   response); if latency grows, split sections into lazy sub-requests.
6. **`app_analytics_events` volume**: the active-30d distinct count needs an
   index sanity check before shipping the query.
7. **50-row health cap** becomes visible in the queue — surfaced via
   `businessHealthTotal` rather than silently truncating.

## 15. Explicitly out of scope

- True session impersonation (D1). App (mobile) changes. Localization of the
  admin console. Server-side gating of static admin HTML (Vercel middleware —
  pre-existing Dan-gated follow-up). Prospect/Sales-AI feature work beyond
  moving nav placement. Any change to owner/consumer-facing surfaces.
