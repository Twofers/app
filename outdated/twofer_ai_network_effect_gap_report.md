# Twofer AI Network-Effect Gap Report

Date: 2026-07-05

Scope: read-only audit of the current repo for an AI-assisted local network-effect system operated mostly from `www.twoferapp.com/admin`. No implementation was performed beyond updating this report.

## Source Notes And Conflicts

- Code, migrations, and Edge Function source were treated as the source of truth where docs conflict.
- Local migration inventory currently has 109 files. The latest file is `20260801121000_profiles_app_locale.sql`.
- Older AI Studio dev docs say a dev APK may use the production Supabase project while publishing is disabled. The repo-level `AGENTS.md` instruction is stricter and newer: AI Deal Studio dev builds must use a separate Supabase development project, not production.
- Hosted Supabase state was not queried. Tables/functions below are repo-local unless the release docs explicitly say a production step was applied.
- `docs/release/WEBSITE_BUSINESS_ONBOARDING_FLOW.md` says `20260730123000_business_applications.sql`, `submit-business-application`, and the public website were approved/deployed on 2026-07-01. It also says the admin onboarding invite-gate migration, admin trial request function, and app-facing onboarding Edge Functions were still local-only at that time.

## 1. Existing Admin Dashboard Features Already Built

Admin website pages exist under `website/admin/`:

- `/admin/login`: email/password admin login through `admin-auth-session`, including refresh-token handling and MFA enrollment/verification support.
- `/admin`: dashboard summary backed by `admin-dashboard-summary`, with metrics for businesses, trial requests, live offers, AI spend, claims/redemptions, billing signals, security, recent applications, and recent audit rows.
- `/admin/businesses`: read-only business directory with status/access/verification/risk and owner email inferred from linked applications.
- `/admin/businesses/:businessId`: business detail shell with linked applications and audit rows. Deeper profile/source/activity actions are still placeholders per `docs/release/WEBSITE_ADMIN_DASHBOARD_FLOW.md`.
- `/admin/businesses/new`: field-sales/manual trial creation backed by `admin-business-applications` action `create`.
- `/admin/trial-requests`: list/filter/approve limited/approve full/waitlist/reject workflow through `admin-business-applications`.
- `/admin/offers`: read-only recent `deals` list.
- `/admin/billing/events`: read-only legacy `billing_provider_events` list.
- `/admin/audit-log`: read-only `admin_audit_log`.
- `/admin/settings`: read-only launch areas, feature flags, and admin users where the role can view them.
- AI usage/quota panel on `/admin`: owner lookup by email/user ID, per-business quota usage, and audited quota reset through `admin-ai-usage`.

Admin backend/security already present:

- `admin_users` allowlist with roles: `owner`, `admin`, `support`, `sales`, `finance`, `moderator`, `developer`, `read_only`.
- `admin_audit_log`, `admin_notes`, `launch_areas`, `feature_flags`, `system_events`.
- MFA enforcement through `require_mfa` and JWT AAL checks.
- Redeemer/staff sessions blocked from admin functions.
- Admin functions use service role server-side instead of browser direct writes.

## 2. Existing Mobile App Features Already Built

Consumer/mobile:

- Email/password auth, hard role split through `profiles.role`, onboarding, ZIP/radius/location preferences, notification preferences, and app locale.
- Home/feed, map, business profile, deal detail, wallet, settings, and favorites/saved businesses.
- Favorites are stored in `favorites` and used in home, deal detail, business detail, map/feed targeting, weekly digest, and saved-customer owner metrics.
- Live offer viewing, claim, wallet countdown, visual redemption, QR/short-code fallback redemption, stale-redeem finalization, and analytics events.
- Push registration/preferences exist through `push_tokens`, `consumer_profiles.notification_mode`, and `consumer_profiles.deal_alerts_enabled`.
- Share Deal exists behind `EXPO_PUBLIC_ENABLE_SHARE_DEAL` using `deal_shares` and `deal-link`.

Business/mobile:

- Business setup creates/updates `businesses` and `business_profiles`.
- Create flows: quick, AI, menu scan, menu manager, menu offer, reuse/templates, AI compose.
- Merchant dashboard and deal analytics show aggregate claim/redemption/customer insights.
- Redeem tab supports QR token and short-code redemption.
- Account/profile, legal links, delete account, billing status surfaces, and billing deeplink guards.
- AI Deal Studio dev route/function exists as draft-only with publishing disabled.

Important boundary:

- Existing mobile app still has merchant create/dashboard/redeem/account features. The new local network-effect system should not add admin, CRM, bulk import, prospect scoring, field-sales, billing operations, or AI operating-report workflows to mobile.

## 3. Existing Supabase Tables Related To Requested Areas

Businesses/business profile:

- `businesses`: canonical app-visible business profile, owner, status/access/verification/risk/admin fields, launch area, contact/address fields, source onboarding request, profile completion.
- `business_profiles`: business/account profile and legacy billing/subscription columns.
- `business_locations`, `location_entitlements`: locations, billing/trial entitlement state, publish access fallback.
- `business_members`, `business_invites`: website/app onboarding linkage and owner/member association.
- `business_contact_channels`, `business_slow_hours`, `business_promotable_items`: imported onboarding facts useful for seeding and enrichment.
- `business_profile_field_sources`, `business_profile_revision_log`, `business_setup_checklist`, `terms_acceptances`: source tracking, revision history, setup status, and terms acceptance.
- `business_brand_profiles`, `business_social_connections`, `business_media_assets`, `business_media_import_jobs`: AI/ad/media foundation.

Offers/deals:

- `deals`: live/past offer rows used by app feed, detail, dashboard, notifications, claims.
- `deal_templates`, `business_menu_items`: reuse/menu-driven offer creation.
- `offer_definitions`, `offer_versions`: authoritative offer facts and immutable published snapshots.
- `publish_events`: server-side publish event history for offer versions.
- `ad_generation_jobs`, `ad_creatives`, `ad_creative_feedback`: durable AI/ad-generation foundation.
- `ad_localizations`: server-side localization storage.

Favorites, notifications, demand/activity:

- `favorites`: user-to-business saved businesses.
- `deal_claims`, `redemptions`, `failed_redeem_attempts`: claim/redemption lifecycle and security.
- `app_analytics_events`: append-only consumer/merchant events.
- `deal_viewed_daily`: deduped daily deal views.
- `deal_shares`: public/share link records with open counters.
- `push_tokens`: Expo push token storage.
- `consumer_profiles`: ZIP, birthdate, location prefs, `notification_mode`, `deal_alerts_enabled`.
- `deal_push_events`: service-role-only deal release-push idempotency/audit table.

AI usage/quota/audit:

- `ai_generation_logs`: AI request audit, quota basis, model/prompt metadata, response payload.
- `ai_generation_costs` plus views `ai_generation_cost_daily`, `ai_generation_cost_by_business`, `ai_generation_cost_by_deal`, `ai_generation_cost_by_feature_model`.
- `admin_ai_quota_resets`: additive admin reset ledger.
- `ai_provider_circuit_breakers`: provider health/circuit breaker state.
- `admin_audit_log`, `admin_notes`, `system_events`.

Trial requests/business applications:

- `business_applications`: public website/admin-submitted access requests, deterministic risk fields, status/access tier, trial limits, field-invite token hash placeholders.
- `business_onboarding_requests`: raw/normalized onboarding request, owner email, risk, admin review status, IP/user-agent.

Stripe/billing:

- Legacy/current billing tables include `app_config`, `subscription_history`, `billing_accounts`, `billing_provider_events`, `trial_checkout_intents`, `admin_no_card_trial_grants`, `billing_trial_reminder_events`, `billing_refund_requests`, `business_duplicate_review_queue`, and location/deal credit tables.
- New business billing mirror includes `business_billing_profiles`, `business_subscriptions`, `billing_events`, `stripe_checkout_sessions`, `stripe_portal_sessions`, `stripe_sync_jobs`, `billing_reminders`, `billing_tokens`.

Requested names not found as exact table names:

- No `notification_preferences` table; notification settings are on `consumer_profiles`.
- No `trial_requests` table; equivalent is `business_applications` plus `business_onboarding_requests`.
- No `offers` table; live offers are `deals`, with versioned facts in `offer_definitions`/`offer_versions`.
- No `ad_specs` table; ad specs are JSON in `offer_versions`/`ad_creatives`.
- No `ai_usage` or `ai_usage_events` table; equivalent data is `ai_generation_logs`, `ai_generation_costs`, and `admin_ai_quota_resets`.
- No exact `admin_audit` table; exact table is `admin_audit_log`.
- No first-class `claim_token` or `public_link` table; claim token fields live on `deal_claims`/local SecureStore, public share links live in `deal_shares` and `deal-link`.

## 4. Existing Edge Functions Related To The Requested Areas

Admin/web actions:

- `admin-auth-session`: admin login, refresh, MFA enrollment/verify, admin allowlist enforcement, audit logging.
- `admin-dashboard-summary`: summary metrics and read-only section data; every view is audited.
- `admin-ai-usage`: owner lookup, per-business AI quota usage, quota reset.
- `admin-business-applications`: list/create/approve/waitlist/reject business applications and field trials.
- `submit-business-application`: public website access-request intake with honeypot, rate limits, deterministic risk routing, onboarding request creation, and Stripe sync queue.
- `get-business-onboarding-context`, `update-business-profile-section`: app-safe website-to-app onboarding/profile sync.

OpenAI/Gemini/AI:

- `ai-compose-offer`, `ai-generate-ad-variants`, `ai-generate-deal-copy`, `ai-business-lookup`, `ai-deal-suggestions`, `ai-extract-menu`, `ai-translate-deal`, `ai-studio-generate-draft`.
- `ai-create-deal` exists but is intentionally disabled and should return HTTP 410.
- Shared provider code supports OpenAI as primary text provider and Gemini for configured fallback/judging/vision/image paths. Provider keys stay in Edge secrets.

Offers/claims/notifications:

- `publish-offer-version`, `claim-deal`, `redeem-token`, `begin-visual-redeem`, `complete-visual-redeem`, `cancel-visual-redeem`, `finalize-stale-redeems`, `release-claim`.
- `send-deal-push`, `weekly-deal-digest`, `send-trial-ending-reminders`, `deal-link`, `ingest-analytics-event`.

Billing/Stripe:

- `billing-pricing`, `stripe-create-checkout-session`, `stripe-customer-portal-session`, `stripe-ensure-customer`, `stripe-backfill-customers`, `stripe-webhook`, `billing-checkout-redirect`, `stripe-expire-pending-checkout`, `stripe-cancel-trial-subscription`, `stripe-cancel-paid-subscription`, `stripe-request-introductory-refund`, `simulate-subscribe` (QA-only).

Redemption/staff:

- `activate-redemption-mode`, `exit-redemption-mode`, `manage-redemption-devices`, `owner-redemption-security`, `staff-redemption`.

## 5. Existing Website Claim/Onboarding/Billing Flows

Website onboarding:

- `/business` redirects to `/business/start-trial/`.
- `/business/start-trial/` posts to `submit-business-application`.
- `/business/thanks/`, `/business/review-pending/`, and `/business/waitlist/` exist.
- Public form collects business name, owner/manager, email, phone, address, type, website/Instagram, slow hours, offer interests, launch area, terms/privacy acknowledgement, and honeypot.
- Public intake does not materialize a business or Stripe customer solely from submitted email. Authenticated owner/app sync handles materialization later.

Website billing:

- Static pages exist for `/business/billing/start`, `/success`, `/cancel`, `/manage`, `/add-payment-method`, `/status`.
- Public copy clearly says billing is web/admin/Stripe-hosted and outside the mobile app.
- Checkout/Portal session creation exists in Edge Functions. Public static pages do not expose direct self-serve checkout forms in the audited files.

Website share/claim:

- `/s` share landing uses `deal-link` for app/deep-link handling and does not expose private claim or redemption tokens.
- No general public business claim-link/onboarding-by-token flow for unclaimed prospect businesses was found.

## 6. What Can Be Reused

- Admin auth/MFA/allowlist/audit pattern for every new admin-only workflow.
- `business_applications` and `business_onboarding_requests` as reviewed intake starting points.
- `businesses` as the canonical app-visible claimed/onboarded business profile.
- `business_profile_field_sources` and `business_profile_revision_log` for AI/import/admin enrichment provenance.
- `business_slow_hours` and `business_promotable_items` for seeded local facts and sales scripts.
- `favorites`, `deal_claims`, `deal_viewed_daily`, `deal_shares`, and `app_analytics_events` as demand proof inputs.
- `business_saved_customers_count` and `business_repeat_visit_stats` RPCs for owner-facing aggregate proof after a business is on Twofer.
- `push_tokens`, `notification_mode`, `deal_alerts_enabled`, `send-deal-push`, and weekly digest infrastructure for existing opted-in notification channels.
- `ai_generation_logs`, `ai_generation_costs`, provider router, cost budget, circuit breaker, and quota reset ledger for OpenAI/Gemini operating reports.
- `offer_definitions`, `offer_versions`, `ad_generation_jobs`, and `ad_creatives` for future safe AI ad/offer creation after a business is claimed/approved.
- Stripe billing mirror tables and functions for admin/web billing signals, not mobile billing.

## 7. What Is Missing

- First-class unclaimed/prospect business model separate from `businesses`, with labels that cannot imply partnership.
- Public customer-facing demand capture for businesses not on Twofer yet.
- Admin prospect search/import/enrichment queue.
- AI enrichment records for prospect facts with source URLs, confidence, review status, and stale/needs-refresh handling.
- Prospect scoring records using demand, category fit, geography, freshness, and sales readiness.
- Demand proof rollups by business/prospect, ZIP/radius, segment, time window, favorites/requests/views.
- Field sales pipeline: assigned reps, stages, next action, call/visit/email logs, scripts, objections, outcome tracking.
- Secure public claim links/tokens for businesses to claim their seeded profile.
- Trial creation flow tied to a prospect/claim link with auditable conversion from unclaimed to claimed to trialing.
- Admin AI operating reports for enrichment volume, costs, provider failures, score distributions, conversion, sales activity, and stale data.
- Bulk import and dedupe workflows in admin.
- Public labels/state model for exactly: `Not on Twofer yet`, `On Twofer`, `Live offer available`.
- Guardrails to prevent seeded prospect rows from appearing as partner/live offers or creating fake deals.

## 8. What Should Be Admin-Only

- Bulk import, Places/web research, prospect dedupe, AI enrichment, prospect scoring, CRM stages, field-sales assignments, scripts, objection notes, contact attempts, claim-link creation, trial creation, billing follow-up, quota resets, provider/cost reports, and internal audit views.
- Any AI call that uses OpenAI/Gemini for scoring, structured JSON, scripts, demand reports, or operating reports.
- Any service-role materialization from prospect/application into `businesses`.
- Any billing/Stripe Checkout/Portal/customer creation/backfill operation.
- Any moderation or review of AI-sourced facts before they are public.

## 9. What Must Be Added To The Mobile App

Keep this minimal:

- Customer request/favorite action for a visible unclaimed local business, with localized copy that says `Not on Twofer yet`.
- Public/local business display state that clearly distinguishes:
  - `Not on Twofer yet`
  - `On Twofer`
  - `Live offer available`
- Notification/deep-link handling for eventual live offers from requested/favorited businesses, using existing push consent preferences.
- Optional consumer-facing demand proof copy such as `Requested` or `Saved` without implying partnership or offer availability.
- No admin, CRM, bulk import, billing, AI scoring, or sales workflows.

## 10. Database Migrations Needed

Recommended additive migrations:

- `business_prospects`: unclaimed/local seed records with source, normalized name/address/category, geo fields, status, public label state, confidence, duplicate/linked `business_id`, and review state.
- `business_prospect_sources`: source snapshots for Places/web/manual/admin import with URL/provider/source payload hash, confidence, and freshness.
- `business_prospect_enrichments`: AI structured JSON outputs, score components, summaries, generated sales scripts, model/provider metadata, review status.
- `business_demand_signals`: event-level or deduped demand capture for requested/favorited prospect businesses, ZIP/radius, user ID where allowed, source surface, created_at.
- `business_demand_rollups`: materialized daily/weekly rollups by prospect/business/area.
- `business_prospect_scores`: score version, inputs, score, tier, recommended next action.
- `sales_accounts` and/or `sales_tasks`: owner/reps, stage, next action, call/visit/email logs, outcomes, objections.
- `business_claim_links`: hashed token, prospect/application/business link, expiry, max uses, accepted_by, accepted_at, revoked_at.
- `prospect_to_business_links`: immutable conversion history from prospect to application/onboarding request to business.
- Extend `admin_audit_log` action taxonomy for prospect import/enrichment/scoring/claim/trial/sales actions.
- Optional `ai_operating_report_runs` for scheduled/admin-triggered report generation and archived JSON summaries.

RLS/security posture:

- Public/client read access only through safe projections or RPCs that expose approved fields and label state.
- Raw sources, AI enrichments, scores, sales notes, claim tokens, and demand rollups remain admin/service-role only.
- Add redeemer-session block-all policies for every new table created after the redemption-mode migration pattern.

## 11. Edge Functions Needed

Admin-only:

- `admin-prospect-import`: manual/bulk import, dedupe, source capture.
- `admin-prospect-enrich`: OpenAI structured JSON enrichment, optional Google Places/web source integration, source-confidence storage.
- `admin-prospect-score`: compute/recompute score and tier from demand/location/category/freshness/sales signals.
- `admin-demand-proof`: generate demand report for a prospect/business using rollups and safe aggregate customer signals.
- `admin-sales-script`: generate call/email/visit scripts and objection handling with OpenAI.
- `admin-claim-link-create`: create/revoke claim links with hashed tokens and audit entries.
- `admin-trial-create-from-prospect`: convert reviewed prospect/application to trial using existing onboarding/billing helpers.
- `admin-ai-operating-report`: provider/cost/quota/failure/conversion report from AI ledgers and admin actions.

Public/app-safe:

- `public-local-businesses` or equivalent RPC: customer-safe browse/search projection returning label state and no private enrichment/sales data.
- `request-business-on-twofer`: authenticated customer demand capture for prospect businesses.
- `claim-business-profile`: token-based business claim start, with email verification/authentication before materialization.
- `prospect-live-offer-notify`: fan out notifications when a requested prospect becomes an approved business with a live offer, respecting push preferences.

Reuse existing:

- Continue using `submit-business-application`, `admin-business-applications`, `get-business-onboarding-context`, `update-business-profile-section`, Stripe functions, `send-deal-push`, and AI provider shared modules where possible.

## 12. Security And Privacy Risks

- False partnership implication: unclaimed businesses must never use partner language, live-offer styling, claim CTA, or Twofer partner badges.
- Fake deals: seeded prospects must not create `deals` rows or offer cards unless a verified/approved business publishes a real offer.
- Contact/privacy: prospect contact info, owner emails, phone numbers, sales notes, and enrichment sources must be admin-only.
- Token leakage: claim links must be hashed at rest, short-lived, revocable, and never logged or pasted into docs/chat.
- AI hallucination: OpenAI/Gemini enrichment must store source/confidence/review status and avoid overwriting verified facts without review.
- Prompt/provider data: no API keys in Expo; AI calls stay in Edge Functions or secure website backend routes.
- Demand privacy: demand proof shown to businesses should be aggregated and thresholded; do not expose raw customer identities or household-level location.
- Billing safety: keep Stripe/customer/subscription controls web/admin/server-only; no mobile checkout links.
- Abuse/rate limits: public request/claim endpoints need rate limits, bot/honeypot checks where relevant, and audit/system events.
- RLS drift: new tables need explicit RLS, grants, service-role-only write paths, and redeemer block policies.

## 13. Test Plan

Read-only/preflight:

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run typecheck:functions`
- After any approved migration touching RLS, run `node scripts/probe-rls-smoke.mjs`.

Focused unit/source tests:

- Prospect label resolver: `Not on Twofer yet` / `On Twofer` / `Live offer available`.
- Public projection excludes private fields and cannot show unreviewed AI facts as verified.
- Demand capture dedupes/rate-limits and respects auth.
- Claim link hashing, expiry, revocation, one-time use, and audited acceptance.
- AI enrichment/scoring uses structured JSON, stores confidence/source, handles provider failures with sanitized errors.
- Admin role permissions for import/enrich/score/claim/trial/billing/report actions.
- Existing `admin-*` source tests extended for new functions.

Integration/smoke:

- Admin imports/enriches a prospect; mobile sees only `Not on Twofer yet`.
- Customer requests/favorites unclaimed business; admin sees demand proof rollup; no private customer list is exposed.
- Admin creates claim link; business authenticates; profile becomes claimed/onboarded without fake deal creation.
- Admin creates limited/full trial from reviewed prospect; `can_business_publish` result matches expected limits.
- Verified business publishes a real live offer; mobile label changes to `Live offer available`; notifications respect preferences.
- Stripe webhook/checkout/portal paths remain web/admin only.

## Phased Implementation Plan

Phase 0: Confirm source of truth

- Confirm hosted Supabase migration/function deployment state before relying on newer admin/onboarding/billing tables.
- Decide exact public wording keys for `Not on Twofer yet`, `On Twofer`, and `Live offer available` in EN/ES/KO.
- Decide whether unclaimed businesses should appear in Home, Map, or a separate local-businesses segment first.

Phase 1: Safe public/prospect data model

- Add prospect/source/demand/score/claim-link tables with strict RLS.
- Add customer-safe projection RPC/function.
- Add mobile labels and request/favorite capture only; no admin workflows in app.

Phase 2: Admin prospect command center

- Add admin prospect list/detail, import, dedupe, source review, demand proof, and scoring views.
- Build admin-only Edge Functions using existing admin auth/audit patterns.
- Store OpenAI structured JSON outputs and review state; no direct public exposure.

Phase 3: Field sales and claim links

- Add sales tasks/activity/outcomes and script generation.
- Add claim-link create/revoke/accept flow with email/auth verification.
- Convert reviewed claims into existing onboarding requests/business materialization.

Phase 4: Trial/billing/offer activation

- Reuse `admin-business-applications`, business onboarding sync, `can_business_publish`, and Stripe functions for trial creation/billing signals.
- Keep trial/billing controls admin/web-only.
- Ensure no `deals` row exists until the claimed business publishes a real offer.

Phase 5: Operating reports and automation

- Add scheduled/admin-triggered AI operating reports from cost ledgers, audit logs, demand rollups, scoring, and conversion.
- Add provider/cost/failure dashboards and alerts.
- Add regression tests and RLS smoke coverage for the full prospect-to-live-offer path.
