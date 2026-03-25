# Schema summary (users, businesses, deals, claims, analytics)

Plain-English overview aligned with `supabase/migrations/` (including `20260327120000_launch_visual_redeem_analytics.sql`) and app usage.

## auth.users (Supabase Auth)

- **Who**: Every logged-in person.
- **App use**: Session email; `user_id` on claims, favorites, businesses (`owner_id`), `consumer_profiles`, and analytics events.

## businesses

- **What**: One row per business, owned by one auth user (`owner_id`).
- **Relationships**: Many `deals`; referenced by `favorites.business_id`.
- **Account deletion:** In-app self-delete is **not** offered when the user owns at least one business row (or ownership cannot be confirmed); they are directed to **support** instead. Edge `delete-user-account` enforces the same before `auth.admin.deleteUser`.

## deals

- **What**: A published offer (title, schedule, limits, poster, `end_time`, recurring fields, timezone, etc.).
- **Relationships**: Many `deal_claims` per deal.

## deal_claims

- **What**: One customer ticket for one deal (claim-scoped proof for wallet, QR, and visual pass).

**Core fields**

- `user_id` — shopper (always tied internally).
- `deal_id` — offer.
- `token` — secret for QR / server redeem lookup.
- `short_code` — optional manual code for staff.
- `expires_at` — **concrete instance end** (one-time deal end or recurring day’s window end in TZ, capped by campaign `end_time`). Redemption is allowed until **`expires_at` + `grace_period_minutes` (default 10)** everywhere server-side (`claim-deal`, visual redeem edges, `redeem-token`).
- `redeemed_at` — set when redemption completes (visual or QR).
- `created_at` — claimed at (wallet).

**Lifecycle / analytics snapshot (migration)**

- `claim_status` — `active` | `redeeming` | `redeemed` | `expired` | `canceled`.
- `redeem_started_at` — when customer started visual pass window.
- `redeem_method` — `visual` or `qr` when redemption completes (null until then).
- `grace_period_minutes` — default 10; documents policy on row.
- `acquisition_source`, `age_band_at_claim`, `zip_at_claim`, `location_source_at_claim`, `app_version_at_claim`, `device_platform_at_claim`, `session_id_at_claim` — optional snapshots at claim time for aggregated reporting (not raw PII to merchants in current UI).

## favorites

- **What**: Saved businesses per user (`user_id`, `business_id`, unique pair).

## consumer_profiles

- **What**: Shopper profile in Supabase.
- **Fields**: `user_id` (PK), `zip_code`, **`birthdate`** (DATE), optional legacy **`age_range`** (nullable; app prefers birthdate for new onboarding).
- **Note**: `gender` may exist on old DB rows; app does not use it in flows reviewed.

## deal_templates

- **What**: Drafts / templates for create flows.

## app_analytics_events

- **What**: Append-only product events (`deal_viewed`, `deal_opened`, `deal_claimed`, `wallet_opened`, `redeem_*`, `claim_expired`, etc.).
- **Fields**: `event_name`, `occurred_at`, `user_id`, `business_id`, `deal_id`, `claim_id`, `context` (JSONB), `app_version`, `device_platform`.
- **RLS**: Authenticated users may **insert** rows where `user_id = auth.uid()` (via `ingest-analytics-event` Edge). No merchant-facing read in app.

## ai_generation_logs

- **What**: Server-side AI quota/logging (Edge), not wallet-critical.

## Lifecycle (mental model)

1. Shopper claims → `claim-deal` inserts row with token, short code, `expires_at`, status `active`, optional telemetry columns.
2. Shopper **Use Deal** → `begin-visual-redeem` → `redeeming` + window timestamps.
3. Pass completes → `complete-visual-redeem` → `redeemed`, `redeem_method = visual`, or errors if window invalid.
4. Staff scans QR / enters code → `redeem-token` → `redeemed`, `redeem_method = qr`.
5. Past `expires_at` without redeem → treated as expired (UI + server); status may be updated to `expired` over time.

Twofer remains **source of truth** for claim and redemption; no POS integration in scope.
