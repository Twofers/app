# Twofer Mobile App Recreation Design Guide

Date: 2026-07-02

Scope: mobile app and the backend/runtime behavior the app requires. The public website, marketing pages, Vercel deployment, App Store Connect forms, Play Console forms, and store screenshots are intentionally out of scope except where the mobile app depends on server-side intake/billing records.

## Basis And Caveats

This guide is distilled from a read-only audit of the current repo docs, code, migration inventory, Edge Function inventory, and full Git history.

- Git history reviewed: 693 commits, from `0f54df12` on 2026-03-22 through `7e917df2` on 2026-07-02.
- Migration inventory reviewed: 108 local files, from `20250127000000_initial_schema.sql` through `20260801120000_business_repeat_visit_stats.sql`.
- Edge Function inventory reviewed: 47 function folders under `supabase/functions/` plus `_shared`.
- App routes reviewed: Expo Router screens under `app/`, including customer tabs, business tabs, create flows, wallet, redeem, AI Studio dev, and auth/onboarding.
- Deploy docs reviewed: current-state, deployment notes, production checklist, command plan, beta checklist, App Store readiness/submission reports, go-public checklist, AI ad state, billing notes, and localization runbook.

Important conflicts to preserve:

- `docs/deployment-command-plan.md` and `docs/deployment-notes.md` still say 106 migrations. The live repo has 108. Code/file inventory wins.
- Some local migration filenames are timestamped after the current date of 2026-07-02. Treat migration timestamps as ordered migration labels, not proof they were applied on those dates.
- Older current-state/store docs mention Android `versionCode` 31, 38, or 41. The local dirty `app.json` currently says 43. A rebuild should preserve package IDs and release semantics, not copy stale build numbers blindly.
- Recent release docs say some hosted Supabase migrations/functions were deployed after approval, but this audit did not run `supabase migration list` or query hosted Supabase. Treat hosted deploy state as doc-reported, not independently verified here.
- `supabase/functions/ai-studio-generate-draft` exists and is called by the dev app, but `supabase/config.toml` does not have a `[functions.ai-studio-generate-draft]` stanza. Deployment docs use direct function deploy commands for it.
- Product rules say email confirmation stays on. The local Supabase config is local-dev-oriented and should not override the hosted auth policy.
- `docs/release-audit/current-state.md` still describes a guest browsing path. Current locked product decisions and the root `AuthStackGate` make the app auth-first; recreate the auth-first behavior.

## Historical Shape

The app grew in layers. A faithful recreation should reproduce the final behavior, but the history explains why some seams exist.

1. March 22-31: MVP foundation
   - Expo + Supabase app shell.
   - Email/password auth, customer/business role split, tabs, map, wallet, favorites.
   - Business setup, create flows, deal cards, claim/redeem, QR/manual code, visual redemption, analytics, initial i18n.

2. April to early May: pilot hardening
   - RLS, rate limits, dashboard metrics, account flows, billing reliability, walkthrough, route guards, UI polish.
   - Deployment notes and release candidate process started.

3. Late May to June 5: production-style Android and money-flow QA
   - GPT image model changes, UI token polish, feed/onboarding improvements, push digests, nearby RPCs.
   - Repeated APK smoke cycles validated claim, wallet, merchant redeem, dashboard refresh, map stability, and owner demo polish.

4. June 6-18: store readiness, share, role/RLS/security
   - Share Deal MVP, Firebase push config, App Links, iOS config, privacy manifests, support email, iPad off.
   - Hard role split, confirmation resend, purge-user cleanup, Redemption Mode/staff devices, owner PIN, wallet redemption rules, release security gate.

5. June 19-24: AI ad architecture and localization
   - OfferDefinition/OfferVersion contracts, versioned publish, AdSpec/native composed renderer, media library, cost ledger, provider router, sanitized AI errors.
   - Multilingual deal foundation for English, U.S. Spanish, and Korean, with approval gates.
   - AI Deal Studio dev variant and draft function foundation.

6. June 25-July 2: poster workflow, app-store/billing posture, return path
   - Poster ad renderer/publish fixes, localized deal rendering fixes, App Store billing posture, business intake/admin backend, web/admin Stripe reconnection.
   - Return Path phase 1: save-business prompts, saved-customer count, repeat-visit stats, persisted consumer feed sort.

## Product Identity

Twofer is a local deals app with two hard-separated roles:

- Customers browse nearby offers, claim one deal into a wallet, and redeem it in person.
- Businesses create strong offers, publish them, redeem customer tickets, and watch aggregate performance.

Locked product decisions to carry forward:

- Email/password auth only.
- Hard Shopper/Business role split chosen at signup and stored in `profiles.role`.
- No guest or anonymous browsing as a product rule for the current app shell.
- ZIP-only fallback location, with GPS optional after onboarding.
- Birthday optional for customers.
- 13+ age rating.
- iPhone only on iOS; no iPad support.
- Public support email: `support@twoferapp.com`.
- Share Deal ships in v1.
- No ads and no data selling for v1/pilot.
- Voice audio for AI Compose is ephemeral; only transcript/log metadata may be retained.
- Critical offer facts must never be changed by AI creativity.

## App Architecture

Target stack:

- Expo SDK 54, React Native 0.81, React 19, TypeScript.
- Expo Router with typed routes.
- Supabase Auth, Postgres/RLS, Storage, Realtime, and Edge Functions.
- i18next/react-i18next for app copy and deal localization.
- Expo modules: notifications, location, camera, image picker/manipulator, secure store, web browser, haptics, maps, print/sharing, splash, fonts.

Primary packages and build expectations:

- Production package/bundle ID: `com.unvmex2.twoforone`.
- Dev AI Studio package: `com.unvmex2.twoforone.dev`.
- Production app name: `Twofer`; AI Studio dev name: `Twofer Dev`.
- Production EAS builds are app-bundle on Android with remote app versioning/auto-increment.
- Production mobile billing flags must keep in-app Stripe and mobile subscription CTAs off.

Root providers and gates:

- App error boundary.
- Theme provider.
- I18n gate.
- Safe area provider.
- Auth session provider.
- Redemption Mode provider.
- Owner redemption security provider.
- Tab mode provider.
- Auth stack gate.
- Consumer onboarding gate.
- Deep link handlers for password recovery, billing, shared deals, notifications, and legacy tabs.
- Owner PIN gate for merchant routes.

## Navigation Model

Auth-first root stack:

- `index`: redirects based on auth/role/onboarding.
- `auth-landing`: email/password login/signup, role cards, language picker, invite code for business signup.
- `auth-callback`, `forgot-password`, `reset-password`: recovery flows.
- `consumer-profile-setup`: ZIP plus optional birthday.
- `onboarding`: customer GPS/ZIP/radius/category/favorite-shop/notification onboarding.
- `business-setup`: imported or manual business profile setup.
- `(tabs)`: role-specific tab shell.
- `deal/[id]`: deal detail and claim.
- `business/[id]`: public business profile.
- `deal-analytics/[id]`: merchant per-deal analytics.
- `redemption-mode`: staff locked redeem mode.
- `ai-deal-studio-dev`: dev-only AI Studio surface.
- `debug-diagnostics`: gated diagnostics.

Customer tab mode:

- Home: live deals and shops feed.
- Map: nearby businesses/deals map.
- Wallet: active and ended claimed deals.
- Settings: preferences, profile, legal/support, delete account.

Business tab mode:

- Create: offer creation hub.
- Redeem: merchant QR/manual redemption.
- Dashboard: offers and aggregate performance.
- Account: business profile, billing/access posture, staff/security/settings, delete account.

Hidden or redirected tabs:

- Auth tab redirects to auth landing.
- Legacy billing routes redirect into Account and are hidden when mobile billing is disabled.

## Customer Feature Requirements

Auth and profile:

- Email/password signup and login with friendly error mapping.
- Signup role selection stored in profile metadata and `profiles.role`.
- Email confirmation/resend flow for hosted auth.
- Password reset request and recovery-link password update.
- Customer profile gate requiring a valid 5-digit ZIP and either optional birthdate or legacy-compatible profile state.
- Profile edit without gender collection.

Onboarding:

- Choose GPS or ZIP.
- Validate 5-digit U.S. ZIP and geocode it.
- Select browsing radius.
- Pick preferred categories.
- Pick favorite nearby shops.
- Ask for push notification consent separately and store preferences.
- Persist local onboarding completion and sync server preferences.

Home feed:

- Show live active deals, localized to the resolved customer deal locale.
- Support persisted feed sort mode, favorites-only filtering, deals/shops segment, search, radius and category preferences.
- Use `nearby_deals`/`nearby_businesses` RPCs when location is available; degrade to active feed queries when not.
- Track visible deal impressions with viewport visibility dedupe.
- Show claim states: claimable, claimed, claiming, expired, unavailable, sold out, demo blocked.
- Show Share Deal only when `EXPO_PUBLIC_ENABLE_SHARE_DEAL=true`.
- Prompt customers to save/favorite businesses after relevant claim/redeem moments.

Deal detail:

- Hero poster/native composed ad rendering.
- Localized title/description and optional language switch.
- Business info, directions, favorite toggle, share action, report offer action.
- Claim CTA with server-backed claim attempt and user-friendly fallback if the server returns wrapped non-2xx errors.
- QR/code modal after claim and view-existing-ticket path.
- Claim count/remaining display via `deal_claim_counts`.

Business profile browsing:

- Business logo/name/category/hours/contact/directions.
- Active deal list.
- Favorite/unfavorite.
- Localized deal cards.

Map:

- Google Maps native view when a key is configured; friendly fallback when missing.
- Nearby businesses and live deal markers.
- Camera fit to visible markers.
- Live-deal halo styling.
- Stable selection behavior and no Android ANR on load/wait/toggle.

Wallet:

- Active tickets versus Ended tickets.
- Active means not redeemed, not terminal, and before `expires_at + grace_period_minutes`.
- Countdown updates with a one-second tick for urgent wallet state.
- "Use Deal" primary path:
  - Slide-to-confirm modal.
  - `begin-visual-redeem`.
  - Full-screen live visual pass.
  - `complete-visual-redeem`.
  - Ticket moves to Ended as redeemed.
- "QR and code" fallback:
  - Shows QR token and manual short code.
  - Staff can scan/enter it.
- Wallet refresh calls `finalize-stale-redeems` best-effort.
- Cache claim QR tokens in SecureStore by claim ID, because raw tokens are only returned to the claimant.
- Release active wallet claim when supported.
- Share wallet deal when allowed.

Settings:

- Edit customer ZIP/birthday profile.
- Location mode/radius preferences.
- Notification toggle and token registration/unregistration.
- App language selection.
- Legal/support links.
- Diagnostics when explicitly enabled.
- Destructive delete account flow calling `delete-user-account` and showing a web fallback link on failure.

Push and deep links:

- Expo push token registration only after opt-in.
- Deal alerts, weekly digest, release-push scheduling, and claim/redeem notification deep links to deal detail.
- App links/custom scheme:
  - `twoforone://`
  - `twofer://`
  - website share links under `/s/...`
  - Supabase `deal-link` fallback links.

## Business Feature Requirements

Business signup/setup:

- Business accounts are invite-gated unless materialized by reviewed server/admin onboarding.
- Business setup can load imported website/admin context through `get-business-onboarding-context`.
- Manual setup fields:
  - business name
  - address/location
  - phone
  - business email/contact name
  - category
  - hours
  - short description
  - optional latitude/longitude
  - logo upload
- Google Places lookup through `ai-business-lookup` and details lookup.
- Logo upload to `business-logos`.
- Create `businesses`, `business_profiles`, and primary location/profile data as needed.

Account:

- View/edit business profile fields.
- AI-generate description helper.
- Google lookup refresh.
- App language selection and merchant-localization profile.
- Repeat claim policy:
  - `NONE`
  - `COOLDOWN_DAYS`
  - `FOREVER`
- Redemption Mode settings/devices and owner PIN security.
- Merchant access/billing status display with neutral support language when inactive.
- Delete business-owner account with stronger warning that business, deals, and related claim history are removed.

Create hub:

- Primary entry points:
  - AI ad builder.
  - Reuse past deals/templates.
  - Menu manager.
  - Menu scan.
  - Menu offer wizard.
- Quick Deal routes now redirect into the unified AI builder.
- All new user-facing copy must come from localization files.

Menu manager and scan:

- Persist `business_menu_items`.
- Manual add/edit/archive.
- Menu photo scan through `ai-extract-menu`.
- Camera/library permission handling.
- Base64 size limit and low-legibility warnings.
- Deduplicate menu items by name/price.
- Size options support.
- Save extracted rows after owner review.

Menu offer wizard:

- Choose location(s).
- Pick main item, paired item, size(s), pairing type, discount percent or fixed price.
- Validate strong offer.
- Build structured offer/eligibility payload.
- Hand off to AI builder with prefilled facts.

AI ad builder:

- Collect authoritative offer facts before generation:
  - title/hint
  - offer type/mechanics
  - item names
  - price/value
  - quantity limit
  - max claims
  - cutoff
  - schedule/timezone
  - recurring days/window
  - location IDs
  - language/source locale
- Photo selection:
  - upload from camera/library
  - explicit final photo selection
  - optional AI image treatment/edit
  - restore original or prior image versions
  - cap/compress uploads
- Generate/revise through `ai-generate-ad-variants`.
- Show progress with branded penguin card.
- Enforce a soft revision cap.
- Let owner choose copy alternatives, revise copy/image/both, and supply feedback.
- Support standard card and poster format.
- Render previews with native/composed text, not baked critical text in generated pixels.
- Build `OfferDefinitionV1`, `AdSpecV1`, presentation hash, screenshot QA snapshot, localization approval payloads, and deterministic fallback copy.
- Publish through `publish-offer-version` for new create flows.
- Existing-deal edit compatibility may still update `deals` directly; a rebuild should decide whether to keep that compatibility or fully migrate edits to offer versions.
- After publish, call `send-deal-push` best-effort.
- Save templates into `deal_templates`.

Reuse:

- List reusable templates and ended/paused past deals.
- Delete templates.
- Repeat a past deal by preloading AI builder fields.
- Preserve poster/photo fields where possible.

Dashboard:

- Show current month metrics:
  - deals launched
  - claims
  - redemptions
  - redemption percentage
  - unique redeemers
  - impressions
  - opens
  - weekly claims chart
- Read `merchant_business_insights` aggregate RPC.
- Read saved-customer count via `business_saved_customers_count`.
- Read redemption-confirmed repeat visits via `business_repeat_visit_stats`.
- List offers with pagination, status, claim/redeem metrics, schedule state, poster thumbnails.
- Filters: all/live/ended/recurring.
- Sorts: newest/claims/conversion.
- Manage offers:
  - end early
  - pause/resume
  - duplicate/reuse
  - delete old ended offers
  - bulk pause/resume/delete
  - generate flyer PDF
  - export analytics CSV/PDF
- Show monthly stats and insights as optional expandable panels.
- Refresh on focus and after redemption/publish.

Deal analytics:

- Per-deal day chart.
- Owner-checked `merchant_deal_insights` aggregate RPC.
- No raw customer lists.

Redeem tab:

- Staff QR scanner and manual ticket code entry.
- Normalize short code input.
- `redeem-token` for owner/business-tab redemption.
- Branded success receipt.
- Friendly failures, no raw Edge/Postgres/RLS text.

Redemption Mode:

- Owner can activate a locked staff redemption session.
- Staff device session scans or manually enters codes.
- Preview then confirm redemption via `staff-redemption`.
- Owner PIN required to exit/return to owner tools.
- Manage redemption devices.
- Block Android back from escaping staff mode.

AI Deal Studio Dev:

- Separate app variant/package/name.
- Route visible only when dev package and `EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV=true`.
- Publishing must stay disabled with `EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING=true`.
- Calls `ai-studio-generate-draft` in dry-run/copy-only mode unless real AI flags are deliberately configured.
- Stores generated dev assets in private `ai-deal-assets`, not public deal feed storage.
- Native preview overlays business wordmark/logo, headline, offer lines, and compact time window.
- Does not create live `deals` rows.

## Claim, Redemption, And Offer Rules

Server is authoritative.

Claim rules:

- Max 3 claim attempts per user per minute.
- One active claim app-wide per user; re-claiming the same active deal is idempotent.
- Per-business repeat policy is based on prior redemptions, not unredeemed claims.
- Per-deal `max_claims` enforced in Edge and with atomic DB trigger.
- Schedule gates: not started, expired, claim cutoff, recurring day/window, timezone.
- Demo offers cannot be claimed.
- Suspended billing locations cannot take new claims.
- Claim `expires_at` is the concrete offer instance end, not the grace deadline.
- Redeem-by deadline is `expires_at + grace_period_minutes`, default 10.

Claim states:

- `active`
- `redeeming`
- `redeemed`
- `expired`
- `canceled`
- `released`

Visual redeem:

- `active -> redeeming -> redeemed`.
- Stale `redeeming` auto-finalizes after the server TTL.
- `cancel-visual-redeem` is legacy/deprecated and may return 400; current pass UI should not rely on rollback.

Staff/QR redeem:

- QR token is secret and raw token is only returned to the claimant.
- Short code exists for manual fallback.
- Staff/owner redemption validates ownership/session, status, schedule, grace, location where applicable, and idempotency.

Offer quality:

- Deals must be strong or acceptable:
  - BOGO/2-for-1/buy-2-get-1.
  - Meaningful free item.
  - Second-item half/50%.
  - Single clear numeric discount of at least 40%.
  - Clear U.S. dollar bundle/fixed value patterns.
- Weak/vague offers are blocked.
- Multiple competing headline percentages are blocked unless the structural primary offer is clear.
- AI copy must not alter offer mechanics.

## Supabase Data Model

Core app tables:

- `profiles`: hard role split and app tab mode.
- `consumer_profiles`: ZIP, birthdate/legacy age range, alert preferences.
- `businesses`: owner business profile, location/address/category/hours/contact/logo/status/repeat policy.
- `business_profiles`: profile/access/billing support data.
- `business_locations`: physical locations.
- `business_menu_items`: menu/catalog rows and size options.
- `deal_templates`: reusable drafts/templates.
- `deals`: live/published offer rows and legacy canonical customer feed source.
- `deal_claims`: wallet tickets, claim lifecycle, QR token hash, short code, redemption status.
- `favorites`: saved businesses.
- `deal_shares`: share codes and open tracking.
- `app_analytics_events`: product events.
- `business_reports`, `user_reports`: report/abuse support.

Offer/ad versioning:

- `offer_definitions`: authoritative source facts.
- `offer_versions`: immutable published facts/ad specs/localization metadata.
- `publish_events`: publish audit trail.
- claim/redemption offer-version binding columns/triggers.
- customer-safe projection RPCs:
  - `customer_deal_localizations`
  - `customer_deal_poster_specs`

AI/ad/media:

- `ai_generation_logs`
- `ai_generation_costs`
- `ai_provider_circuit_breakers`
- `business_brand_profiles`
- `business_social_connections`
- `business_media_assets`
- `business_media_import_jobs`
- `ad_generation_jobs`
- `ad_creatives`
- `ad_creative_feedback`
- `ad_localizations`

Redemption/staff:

- `redemption_devices`
- `redemptions`
- `owner_redemption_security`
- `failed_redeem_attempts`

Billing/access:

- `app_config`, `app_runtime_config`, and audit table.
- `billing_accounts`
- `location_entitlements`
- `deal_credit_periods`, reservations, ledger.
- `billing_provider_events`
- `business_location_identity`
- `trial_checkout_intents`
- `admin_no_card_trial_grants`
- `business_subscriptions`, billing profiles/events/tokens/reminders.
- Stripe checkout/portal/sync tables.
- refund request and duplicate review tables.

Admin/onboarding back office data the app may depend on:

- `business_applications`
- `business_members`
- `business_onboarding_requests`
- `business_invites`
- `business_contact_channels`
- `business_slow_hours`
- `business_promotable_items`
- `business_profile_field_sources`
- `business_profile_revision_log`
- `business_setup_checklist`
- `terms_acceptances`
- `admin_users`, audit log, notes, feature flags, launch areas, system events

Storage buckets:

- `deal-photos`: public read, owner-scoped writes under business ID prefixes.
- `business-logos`: public read, owner-scoped upload/update.
- `ai-deal-assets`: private AI Studio dev bucket, signed URL preview only.

## Edge Function Requirements

Deploy and preserve behavior for these groups.

Wallet/claim/redeem:

- `claim-deal`
- `redeem-token`
- `release-claim`
- `begin-visual-redeem`
- `complete-visual-redeem`
- `cancel-visual-redeem`
- `finalize-stale-redeems`

Redemption Mode:

- `activate-redemption-mode`
- `exit-redemption-mode`
- `staff-redemption`
- `manage-redemption-devices`
- `owner-redemption-security`

Auth/account/analytics/push:

- `delete-user-account`
- `ingest-analytics-event`
- `deal-link`
- `send-deal-push`
- `weekly-deal-digest`
- `send-trial-ending-reminders`

AI:

- `ai-business-lookup`
- `ai-compose-offer`
- `ai-create-deal` returning HTTP 410 with `AI_CREATE_DEAL_LEGACY_DISABLED`
- `ai-deal-suggestions`
- `ai-extract-menu`
- `ai-generate-ad-variants`
- `ai-generate-deal-copy`
- `ai-studio-generate-draft`
- `ai-translate-deal`
- `publish-offer-version`

Business intake/onboarding/admin support:

- `submit-business-application`
- `get-business-onboarding-context`
- `update-business-profile-section`
- `admin-auth-session`
- `admin-dashboard-summary`
- `admin-ai-usage`
- `admin-business-applications`

Billing/Stripe/web-admin support:

- `billing-pricing`
- `billing-checkout-redirect`
- `simulate-subscribe` as QA/dev only
- `stripe-create-checkout-session`
- `stripe-customer-portal-session`
- `stripe-ensure-customer`
- `stripe-backfill-customers`
- `stripe-expire-pending-checkout`
- `stripe-cancel-trial-subscription`
- `stripe-cancel-paid-subscription`
- `stripe-request-introductory-refund`
- `stripe-webhook`

Shared function principles:

- `verify_jwt=false` in config means every function must authenticate/authorize internally.
- Service role stays server-side only.
- Provider failures must return sanitized codes/messages.
- No raw upstream bodies, secrets, RLS errors, SQL errors, stack traces, QR tokens, claim codes, or redemption tokens in user-facing UI or docs.
- Edge functions that write billing/admin/business records must audit privileged decisions.

## AI And Ad Generation Requirements

Offer facts are authoritative:

- AI may improve wording and visuals, but may not change items, quantities, discount, schedule, location, claim limits, or redemption rules.
- All generated copy must validate against a structured offer contract.
- Deterministic fallback copy must exist for provider failure.

Provider architecture:

- OpenAI text/image paths with model allowlists.
- Gemini optional text/image/vision fallback only behind hosted flags and privacy/subprocessor approval.
- Shared structured text provider router for copy, insights, translation, compose, menu OCR, image QA, and research where applicable.
- Whisper/OpenAI for voice transcription.
- Cost ledger and AI generation logs for all provider attempts.
- Circuit breaker tables and optional budget controls.

Ad output:

- Generated images must avoid baked critical offer text, QR codes, logos, claim CTAs, and private data.
- Native/composed renderer overlays critical text.
- Poster format uses a 4:5 composition and template policy.
- Owner review is required before publish.
- Generated/edited image QA must check item presence and safe zones where enabled.
- Local deterministic copy/style gates catch generic AI phrases, echoed prompt feedback, bare-item hooks, awkward "any" grammar, and weak poster headlines.

Localization:

- English, U.S. Spanish, and Korean are active code targets.
- Customer deal viewing must not call a model; it reads approved or deterministic localized bundles/projections.
- Broad Spanish/Korean rollout remains gated by named native reviewers, screenshot QA, Korean counter approval, and rollout gate scripts.
- Push notifications remain non-multilingual in the v1 policy.

## Billing And Access Posture

Current mobile posture:

- `PAID_BILLING_ENABLED=true` in code, but mobile purchase surfaces are hard-disabled.
- `isMobileStripeEnabled`, mobile subscription CTA, self-serve mobile, pricing page, billing links, and mobile paid billing all return false.
- Merchant tool access is gated by Supabase business/location entitlement status, not in-app Stripe checkout.
- Blocked merchants see neutral support language, not payment prompts.

Backend/web-admin posture:

- Stripe Checkout/Portal/webhook functions and billing tables exist for web/admin-side billing.
- Stripe setup still requires separate test-mode QA before live charging.
- `simulate-subscribe` is dev/QA only.
- Do not recreate the app as an in-app subscription app unless StoreKit/IAP is explicitly chosen later.

## Visual Design System

Brand:

- Name: Twofer.
- Visual motif: penguin mark/logo.
- Primary brand color: orange `#FF9F1C`.
- Small orange text should use accessible `accentText`, not raw primary:
  - light: `#B45309`
  - dark: `#FFB454`
- Single success green is reserved for redemption confirmation.
- Single destructive red for delete/error.
- Neutral gray ramp from `Gray[50]` to `Gray[900]`.

Layout and interaction:

- Mostly flat white/neutral surfaces.
- No drop shadows; 1 px borders create layers.
- Radius scale:
  - 8 for chips/badges
  - 12 for inputs/buttons
  - 16 for cards
  - 999 for pills
- Standard button height: 52.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32.
- Safe-area aware screen metrics for tabs and stacks.
- Android bottom visibility floor for sticky footers.
- Haptic tab buttons.
- Branded confirm modals and switches.
- Skeleton/loading states and empty states.

Typography:

- System UI font for body text.
- Outfit bold for the wordmark on auth landing.
- Screen-title scale around 26/32 with strong weight.
- Avoid negative letter spacing except established title token.
- Avoid text clipping; use wrapping, `maxFontSizeMultiplier`, or dynamic layout.

Core UI components to recreate:

- ScreenHeader.
- PrimaryButton/SecondaryButton.
- CardShell.
- EmptyState.
- Banner.
- BrandedConfirmModal.
- BrandedSwitch.
- LocaleFlag.
- DealCardPoster.
- ComposedAdCard and templates.
- QR modal.
- Wallet visual pass.
- Slide to use deal.
- Wallet QR fallback modal.
- Merchant insights panel.
- Legal external links.
- Report sheet.
- Dancing penguin progress card.

Visual tone:

- Practical local-commerce tool, not a marketing page.
- Cards are information-dense but friendly.
- Orange is for action/attention; green is for redeemed success; most UI is white, neutral, and legible.
- Business screens should feel operational and scannable.
- Customer screens should emphasize nearby, live, claimable offers.

## Localization And Copy

Recreation must include:

- `en`, `es`, and `ko` locale JSON files.
- Locale-aware date/time formatting.
- Locale-aware deal expiry/validity formatting.
- App language selection.
- Deal display locale resolution:
  - device locale
  - customer preferred locale
  - selected per-deal language switch
  - approved localizations/projections
  - deterministic fallback
- Protected term policy and style guides for EN/ES/KO.
- Korean counter registry and approval status.
- Source-locale creative policy.
- Localized owner preview and customer rendering.
- Rollout gates and dashboards.

All new user-facing copy must be localized. Do not add hardcoded strings except temporary developer diagnostics or explicit test defaults.

## Privacy, Security, And Compliance

Must have:

- Email/password only; no social login.
- Supabase session storage in SecureStore with chunking.
- No service role or provider keys in Expo env.
- Public Expo env values only for Supabase URL/anon, legal URLs, feature flags, maps key.
- RLS on app tables, with restrictive policies for sensitive/admin/billing data.
- Account deletion Edge Function using admin delete and purge cleanup.
- Business-owner delete warning about business/deals/claim history.
- Reports for businesses/users/offers.
- Sanitized diagnostic and analytics events.
- Privacy manifest matching actual app data collection.
- Android permissions limited to camera, microphone, coarse/fine location; block overlay, foreground services, and legacy storage permissions.
- Voice audio processed ephemerally.
- QR tokens, claim codes, redemption codes, push tokens, secrets, API keys, certificates, and provisioning data never printed/transcribed into chat/docs/commits.

## Deployment And Runtime Requirements

Migration chain:

- Apply all local migrations in lexicographic order on a fresh project.
- Fresh local inventory is 108 files, despite stale 106-file docs.
- High-risk areas:
  - RLS/policy helpers
  - claim/redeem lifecycle
  - offer versions/localization projections
  - cron/Vault/pg_net jobs
  - billing/Stripe
  - admin/onboarding
  - saved customers/repeat visits
- After RLS migrations, run `node scripts/probe-rls-smoke.mjs`.

Edge deploy:

- Deploy all function folders needed by the app, including shared-code changes.
- Hosted secrets by name only:
  - Supabase service role
  - OpenAI/Gemini provider keys as enabled
  - Stripe keys/webhook secret when billing QA/live
  - Google Places key
  - cron/Vault secret posture
- Never expose secret values.

Expo/EAS:

- Production profile should not enable debug panels.
- Share Deal enabled through `EXPO_PUBLIC_ENABLE_SHARE_DEAL=true`.
- Mobile Stripe/billing flags false.
- Google Maps Android key required for native map.
- AI V4/V5 flags must align with backend migrations/function deploys and rollout gates.
- AI Studio dev profile must use the dev package, dev app name, and disabled publishing.

Cron/background:

- Push-token cleanup.
- Weekly digest.
- Deal release push dispatcher.
- Deal credit reservation sweep.
- Trial ending reminders.

## QA And Acceptance Criteria

Baseline checks:

- `npm run typecheck`
- `npm run lint`
- `npm test`

AI/prompt changes:

- Baseline checks.
- `npm run copy:evaluate`
- `npm run gate:ai-ad`
- Update fixtures/regression tests.

Localization:

- `npm run gate:localization-plan`
- `npm run gate:localization-rollout`
- `npm run dashboard:localization-rollout`
- Native reviewer/screenshot evidence before broad ES/KO rollout.

Backend/RLS:

- `npm run typecheck:functions`
- Focused function tests.
- `node scripts/probe-rls-smoke.mjs` after relevant migrations.
- Edge smoke for claim, redeem, push, AI, delete account, analytics.

Real-device/mobile smoke:

- Signup/login/logout/password reset.
- Customer profile and onboarding with GPS and ZIP fallback.
- Home feed loads.
- Map loads and remains responsive.
- Deal detail opens, claim succeeds, QR/code appears.
- Wallet active ticket appears and countdown is correct.
- Visual Use Deal completes.
- Merchant QR/manual redeem succeeds.
- Wallet moves redeemed ticket to Ended.
- Dashboard metrics refresh in-session.
- Business setup and logo upload.
- AI create publishes a strong deal.
- Weak deal is blocked with friendly copy.
- Menu scan handles good and low-legibility photos.
- Account deletion flows for customer and business owner.
- No raw Supabase/RLS/Edge/internal errors visible.

Store/release tasks still require human approval:

- Release or production-like mobile builds.
- TestFlight/App Store/Play submission.
- Version/build number changes.
- Hosted migrations or function deploys.
- Supabase/Stripe/EAS secret changes.
- Push/merge/tag/reset.

## Minimum Rebuild Checklist

To recreate the whole app, a team must deliver all of the following:

- Mobile shell with auth-first routing, hard role split, customer and business tab modes.
- Supabase schema, RLS, storage buckets, Edge Functions, and hosted secrets matching the app contract.
- Customer browse/map/deal/detail/claim/wallet/redeem/share/settings flows.
- Business setup/account/create/menu/reuse/dashboard/analytics/redeem/redemption-mode flows.
- AI ad builder with authoritative offer contracts, native/composed renderer, provider guardrails, deterministic fallback, cost logs, and versioned publish.
- Localization system for app UI and deals across EN/ES/KO with rollout gates.
- Push notifications, deep links, share links, and app links.
- Billing/access posture with mobile billing disabled and web/admin billing backend isolated.
- Account deletion, reporting, privacy/legal/support links, permission posture, and sanitized errors.
- Flat Twofer visual design system with penguin branding, orange CTA language, neutral surfaces, accessible accent text, and no shadow-heavy/card-nesting redesign.
- Release validation scripts and real-device smoke plan.

Anything less would be a partial clone, not the Twofer app as represented by the current repository.
