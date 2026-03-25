# Twofer — current state (codebase audit)

This document reflects the repository after the launch-hardening pass. Routes and data flows are taken from `app/`, `lib/`, and `supabase/`.

## App routes / screens

### Root stack (`app/_layout.tsx`)

| Route | Screen / purpose |
|-------|------------------|
| `(tabs)` | Main tab navigator (default anchor) |
| `onboarding` | Consumer: location mode, ZIP, radius, notification prefs after profile |
| `consumer-profile-setup` | Consumer: **ZIP + birthday** (date picker). Gender not collected. Legacy `age_range` still satisfies profile gate if present. |
| `business-setup` | Business: category, hours, contact fields → creates `businesses` row |
| `forgot-password` | Password reset request |
| `reset-password` | New password after recovery link |
| `create/ai-compose` | AI compose flow entry |
| `create/reuse` | Reuse templates hub |
| `deal/[id]` | Deal detail, claim, favorites; telemetry + `trackAppAnalyticsEvent` (`deal_opened`, `deal_claimed`) |
| `business/[id]` | Business profile |
| `modal` | Generic modal |
| `index` | Redirects `/` → `/(tabs)` |

### Tabs (`app/(tabs)/_layout.tsx`)

**Customer mode** (visible): `index` (home), `map`, `wallet`, `settings`.

**Business mode** (visible): `create`, `redeem`, `dashboard`, `account`.

**Hidden from tab bar** (still routable): `favorites`, `explore`, `auth`.

### Additional stack screens (no tab)

| Route | Purpose |
|-------|---------|
| `create/quick.tsx`, `create/ai.tsx`, `create/reuse.tsx`, `create/ai-compose.tsx` | Create flows |
| `deal-analytics/[id].tsx` | Per-deal day chart + RPC **aggregated** insights (`merchant_deal_insights`) |

## Consumer flow

1. **Guest**: Browse home, map, deal detail; login from `auth` or entry points on protected actions.
2. **Logged-in customer** (`ConsumerOnboardingGate`): If `consumer_profiles` incomplete (**ZIP + (`birthdate` valid OR legacy `age_range`)**), redirect to `consumer-profile-setup`.
3. If local prefs `onboardingComplete` is false, redirect to `onboarding` (location permission or ZIP fallback, radius, notifications).
4. **Claim**: `claimDeal` sets **`expires_at` to a concrete instance end** (one-time → `deal.end_time`; recurring → today’s window end in deal TZ, capped by campaign `end_time`). **Redeem** (visual, QR, UI) is allowed until **`expires_at` + `grace_period_minutes` (default 10)**. Optional telemetry on insert; returns **`claim_id`** where supported.
5. **Wallet** (`(tabs)/wallet`): Loads `deal_claims` incl. `grace_period_minutes`. Calls **`finalize-stale-redeems`** on refresh/focus. Sections **Active** vs **Ended**. Active = not redeemed and **before redeem-by deadline** (`expires_at` + grace). Live clock via `useSecondTick`.
   - **Primary path:** **Use Deal** → slide-to-confirm (`WalletUseDealSlideModal`) → `beginVisualRedeem` → full-screen **live pass** (`WalletVisualPassModal`, ~15s window, motion) → `completeVisualRedeem` → claim moves to Ended as redeemed.
   - **Fallback:** **QR & verify** opens `WalletRedeemModal` (staff-oriented display; QR encodes claim **token**).
6. **Favorites / map**: `favorites` and browse UX.

## Business flow

1. Switch to **business** tab mode (`lib/tab-mode`).
2. **Business setup** → `businesses` row.
3. **Create** → `deals` (+ photos storage where applicable).
4. **Dashboard** (`dashboard`): Per-deal list metrics + **`merchant_business_insights`** RPC (aggregated age bands, masked ZIP clusters, acquisition mix, redeem method mix, new vs returning, avg claim→redeem, hourly pattern). No raw customer lists.
5. **Redeem** (`redeem`): Scan QR (`redeem-token` with `token`) or **claim code** (`short_code`). Sets `redeem_method: 'qr'`, final `claim_status: 'redeemed'`.
6. **Account**: Business profile, **delete account** policy (Edge `delete-user-account`), legal links, sign-out.

## Auth flow

- **Supabase Auth** email/password (`(tabs)/auth`).
- **Forgot / reset**: `forgot-password`, `reset-password` + `AuthRecoveryLinkHandler` in root layout.
- **Sign out**: `supabase.auth.signOut()` from account screen.
- **Delete account**: **Consumers** (no `businesses` row for `owner_id`): in-app via Edge `delete-user-account` → `auth.admin.deleteUser`; on failure, alert + link to the configured delete-account URL. **Business owners** (≥1 business row) or **ambiguous** business lookup: in-app self-delete **blocked** with localized **contact support** (`SUPPORT_URL`); Edge returns **403** with `code: BUSINESS_OWNER_DELETE_BLOCKED` if the function is called anyway. See `docs/deployment-notes.md`.

## Onboarding fields (launch scope)

| Stage | Fields / behavior |
|-------|-------------------|
| Consumer profile (`consumer-profile-setup`) | Email from session; **ZIP**; **birthday** (ISO date). `upsertConsumerProfile` writes `birthdate`, clears legacy `age_range`. Gender not used. |
| Consumer onboarding (`onboarding`) | ZIP sync, GPS vs ZIP fallback (`consumer-preferences` + `expo-location`), radius, notification permission/prefs. |

## Wallet / redeem flow

- **Active**: not `redeemed_at`, redeem-by not passed, not terminal status. Countdown / copy use **redeem-by** (`expires_at` + grace).
- **Ended**: redeemed, expired (past redeem-by or `expired` status), or **canceled**.
- **Visual redeem**: `active → redeeming → redeemed`; **~30s** after `redeem_started_at`, server auto-finalizes **`redeemed`** (visual). `cancel-visual-redeem` returns **400** (no rollback to active).
- **QR redeem**: `redeem-token` (after ownership check, runs same stale-finalize). Invalid after redeem or past redeem-by.

## Notification flow

- **Expo Notifications**: onboarding + settings; `lib/notifications.ts`.
- **Deep links**: `NotificationDeepLinkHandler` → `path` or `dealId` → `/deal/:id`.

## Location flow

- Modes in `consumer-preferences`: GPS vs ZIP (`lib/consumer-location.ts`, `resolveConsumerCoordinates`).

## Settings / account

- Settings tabs for consumer/business; profile edit routes. **Legal & support** (`lib/legal-urls.ts`, defaults `https://www.twoferapp.com/...`): privacy, terms, support, delete-account — overridable via `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_OF_SERVICE_URL`, `EXPO_PUBLIC_SUPPORT_URL`, `EXPO_PUBLIC_DELETE_ACCOUNT_URL`. `LegalExternalLinks` (privacy + terms + support) on auth, account (signed-out), settings, business setup, forgot-password, reset-password. Delete-account web link in Account’s delete section (**consumer** self-delete path) and in the alert after failed in-app deletion.

## Supabase tables used by the app (direct `.from(...)` in app/lib)

| Table | Typical use |
|-------|-------------|
| `businesses` | Owner business row, profile, browse, map |
| `deals` | Listings, detail, analytics, notifications |
| `deal_claims` | Wallet, claim status, redeem lifecycle, dashboard stats |
| `favorites` | Saved businesses |
| `consumer_profiles` | ZIP, **birthdate**, optional legacy `age_range` |
| `deal_templates` | Reuse / create flows |
| `app_analytics_events` | Append-only events via Edge (client does not `.from` this table; uses `ingest-analytics-event`) |

**Edge / server-only**: `ai_generation_logs`, etc.

**Storage**: `deal-photos` bucket (AI create paths).

## Edge functions invoked from the client

| Function | Client entry |
|----------|----------------|
| `claim-deal` | `lib/functions.ts` |
| `redeem-token` | `lib/functions.ts` (business redeem) |
| `begin-visual-redeem` | `lib/functions.ts` |
| `complete-visual-redeem` | `lib/functions.ts` / `wallet-visual-pass.tsx` |
| `cancel-visual-redeem` | (deprecated; returns 400 — not used from pass UI) |
| `finalize-stale-redeems` | `lib/functions.ts` / wallet load |
| `delete-user-account` | `lib/functions.ts` / account screen |
| `ingest-analytics-event` | `lib/app-analytics.ts` |
| `ai-generate-deal-copy`, `ai-create-deal`, `ai-generate-ad-variants`, `ai-compose-offer` | create / compose flows |

**Migrations** (apply in Supabase): `20260327120000_launch_visual_redeem_analytics.sql`; `20260328140000_merchant_insights_rpc.sql` (`merchant_deal_insights`, `merchant_business_insights`).

**RPC** (authenticated, owner-checked): `merchant_business_insights`, `merchant_deal_insights` — used by dashboard / deal analytics panels.

## New / expanded i18n surfaces (EN / ES / KO)

- **`consumerWallet.*`**: Use Deal, slide-to-confirm, full-screen pass, countdown, errors, ended labels, QR fallback copy.
- **`consumerProfile`**: Birthday strings; removed age-chip-only flow from EN/ES/KO.
- **`dealStatus`**: `redeeming`, `canceled`.
- **`apiErrors.*`**: Mapped Edge errors (visual redeem, claim, redeem).
- **`ageBands`**: Display labels for derived bands (UI only).
- **`offersDashboard` / dashboard metrics**: e.g. expired unredeemed row label.
- **`settingsConsumer`**: Copy mentions birthday.

Date/time: `formatAppDateTime`, `formatDealExpiryLocal`, and related helpers remain locale-aware.

## Related shared UI

- `components/wallet-redeem-modal.tsx` — QR / verify fallback.
- `components/wallet-visual-pass.tsx` — full-screen live pass.
- `components/wallet-use-deal-slide-modal.tsx` — slide to confirm.
- `components/slide-to-use-deal.tsx` — gesture slider.
- `components/merchant-insights-panel.tsx` — merchant-facing aggregate metrics.
- `components/legal-external-links.tsx` — privacy / terms URLs.
- `hooks/use-second-tick.ts` — 1s refresh for countdowns.
