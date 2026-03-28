# TWOFER — Full Codebase Audit & Developer Handoff Report

**Generated:** 2026-03-27  
**Codebase:** `twoforone` (Expo React Native + Supabase)  
**Purpose:** Complete audit for a developer who has never seen this codebase.

---

## Section 1: Project Overview

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Expo (SDK 54) | `~54.0.33` |
| UI | React Native | `0.81.5` |
| React | React 19 | `19.1.0` |
| Navigation | Expo Router (file-based) | `~6.0.23` |
| Backend | Supabase (Postgres + Edge Functions on Deno) | `^2.93.1` |
| State | React Context (single `TabModeProvider`) + local `useState` | — |
| Animations | React Native Reanimated | `~4.1.1` |
| i18n | i18next + react-i18next | `^25.10.5` / `^16.6.2` |
| Maps | react-native-maps | `1.20.1` |
| Camera | expo-camera | `~17.0.10` |
| QR Code | react-native-qrcode-svg | `^6.3.21` |
| Date Utils | date-fns | `^4.1.0` |
| TypeScript | TypeScript (strict) | `~5.9.2` |
| Test Runner | Vitest | `^3.2.4` |
| Linter | ESLint (expo config) | `^9.25.0` |
| Build | EAS Build | via `eas.json` |

### Project Structure

```
twoforone/
├── app/                    # Expo Router screens (32 files)
│   ├── _layout.tsx         # Root Stack navigator + global providers
│   ├── index.tsx           # Cold-start auth gate
│   ├── auth-landing.tsx    # Login/signup screen
│   ├── business-setup.tsx  # Business onboarding form
│   ├── onboarding.tsx      # Consumer onboarding (location, zip, radius)
│   ├── consumer-profile-setup.tsx  # ZIP + birthdate
│   ├── forgot-password.tsx # Password reset request
│   ├── reset-password.tsx  # Set new password
│   ├── (tabs)/             # Bottom tab navigator (16 files)
│   │   ├── _layout.tsx     # Tab bar + auth gate + mode redirect
│   │   ├── index.tsx       # Consumer deal feed (819 lines)
│   │   ├── dashboard.tsx   # Business analytics (735 lines)
│   │   ├── wallet.tsx      # Claimed deals wallet (748 lines)
│   │   ├── create.tsx      # Deal creation hub
│   │   ├── redeem.tsx      # Merchant QR/code redeem
│   │   ├── map.*.tsx       # Map views (platform-specific)
│   │   ├── account.tsx     # Account + business profile (1035 lines)
│   │   ├── settings.tsx    # Consumer settings
│   │   └── favorites.tsx   # Favorited deals (hidden tab)
│   ├── create/             # Deal creation flows
│   │   ├── quick.tsx       # Quick BOGO publish (360 lines)
│   │   ├── ai.tsx          # Full AI ad creation (1447 lines)
│   │   ├── ai-compose.tsx  # AI compose offer (449 lines)
│   │   └── reuse.tsx       # Reuse templates/past deals
│   ├── deal/[id].tsx       # Deal detail screen
│   ├── business/[id].tsx   # Business profile screen
│   └── deal-analytics/[id].tsx  # Per-deal analytics
├── components/             # Shared UI components (30 files)
├── constants/theme.ts      # Design tokens (colors, spacing, radii)
├── hooks/                  # React hooks (6 files)
├── lib/                    # Business logic, API wrappers, i18n (61 files)
├── supabase/
│   ├── functions/          # Edge Functions (12 functions, 26 files)
│   ├── migrations/         # SQL migrations (19 files)
│   └── seed*.sql           # Seed data (3 files)
├── scripts/                # Build/seed/locale scripts
├── docs/                   # Internal documentation (17 files)
├── website/                # Static landing page
└── store-assets/           # App store copy and EAS notes
```

### How to Run

```bash
# Install dependencies
npm install

# Create .env with required vars (see below)
cp .env.example .env

# Start local Supabase
npx supabase start

# Start Expo dev server
npx expo start          # press 'a' for Android emulator

# Seed demo data
npm run seed:demo

# Run tests
npm test

# Type check
npm run typecheck

# Reset Supabase + clear Metro cache
npx supabase stop && npx supabase start
npx expo start -c
```

### Environment Variables

**Required (client-side, in `.env`):**

| Variable | Where Referenced | Purpose |
|----------|-----------------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | `lib/supabase.ts` (line 9) | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase.ts` (line 10) | Supabase anonymous key |

**Required (Supabase Edge Function secrets — set in Dashboard):**

| Variable | Where Referenced | Purpose |
|----------|-----------------|---------|
| `OPENAI_API_KEY` | All AI edge functions | OpenAI API access |
| `SUPABASE_URL` | All edge functions (auto-injected) | Edge function DB access |
| `SUPABASE_SERVICE_ROLE_KEY` | All edge functions (auto-injected) | Service role access |

**Optional:**

| Variable | Purpose |
|----------|---------|
| `EXPO_PUBLIC_GIT_COMMIT` | Build version display |
| `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER` | Enable demo@demo.com auto-signup |
| `EXPO_PUBLIC_SHOW_DEBUG_PANEL` | Show debug diagnostics in settings |
| `EXPO_PUBLIC_DEBUG_BOOT_LOG` | Verbose boot logging |
| `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` | Google Maps on Android |
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | Legal link override |
| `EXPO_PUBLIC_TERMS_OF_SERVICE_URL` | Legal link override |
| `OPENAI_MODEL` | Override default model (`gpt-4o-mini`) |
| `AI_ADS_DEMO_USE_LIVE` | Use real OpenAI for demo account |
| `AI_MONTHLY_LIMIT` | Override 30/month AI compose quota |
| `AI_COOLDOWN_SECONDS` | Override cooldown between AI calls |

---

## Section 2: Architecture Map

### Frontend: Navigation Structure

The app uses **Expo Router** with file-based routing. The root `app/_layout.tsx` wraps everything in:

1. `AppI18nGate` — hydrates i18n before rendering children
2. `SafeAreaProvider`
3. `TabModeProvider` — the **only React Context** in the app; switches between "customer" and "business" tab sets; persisted to AsyncStorage
4. `Stack` navigator with all routes
5. `ConsumerOnboardingGate` — redirects to profile setup/onboarding when needed
6. `NotificationDeepLinkHandler` + `AuthRecoveryLinkHandler`

**Route tree:**

```
/                           → Cold-start: signs out, redirects to /auth-landing
/auth-landing               → Login/signup with penguin hero
/onboarding                 → Consumer: language → location → zip → radius → notifications
/consumer-profile-setup     → ZIP + birthdate
/business-setup             → Business profile form
/forgot-password            → Request password reset
/reset-password             → Set new password (recovery flow)
/(tabs)/                    → Bottom tab navigator
  ├── index                 → Consumer deal feed (home)
  ├── wallet                → Claimed deals + visual redeem
  ├── map.*                 → Map of businesses/deals
  ├── dashboard             → Business analytics
  ├── create                → Deal creation hub
  ├── redeem                → Merchant QR/code scanner
  ├── account               → Login/profile/settings (business side)
  ├── settings              → Consumer settings
  ├── favorites             → Hidden tab (href: null)
  ├── auth                  → Redirect to /auth-landing
  └── explore               → Re-exports auth tab
/create/quick               → Quick BOGO deal publish
/create/ai                  → Full AI ad creation flow
/create/ai-compose          → AI compose offer (voice + image)
/create/reuse               → Reuse templates/past deals
/deal/[id]                  → Deal detail
/business/[id]              → Business profile
/deal-analytics/[id]        → Per-deal analytics
/debug-diagnostics          → Dev: JSON env/auth dump
/modal                      → Template modal (unused)
```

### State Management

There is **no Zustand, Redux, or Jotai**. State is managed through:

1. **`TabModeProvider`** (`lib/tab-mode.tsx`): The only React Context. Stores "customer" | "business" mode in AsyncStorage.
2. **`useBusiness` hook** (`hooks/use-business.ts`): Auth session + business row lookup. Used by most screens.
3. **Local `useState`**: Every screen manages its own state. Large screens like `app/(tabs)/index.tsx` (819 lines) and `app/create/ai.tsx` (1447 lines) have 20+ state variables.
4. **AsyncStorage**: Consumer preferences (location, radius, notification settings).

### Backend: Supabase Edge Functions

| Function | File | Purpose |
|----------|------|---------|
| `ai-compose-offer` | `supabase/functions/ai-compose-offer/index.ts` | AI compose from text/image/voice; includes transcription, quota, cooldown, dedup |
| `ai-create-deal` | `supabase/functions/ai-create-deal/index.ts` | Legacy: AI + auto-insert deal from photo |
| `ai-generate-ad-variants` | `supabase/functions/ai-generate-ad-variants/index.ts` | Generate 3 ad variants (value/neighborhood/premium) from photo |
| `ai-generate-deal-copy` | `supabase/functions/ai-generate-deal-copy/index.ts` | Text-only deal copy (title, promo, description) |
| `claim-deal` | `supabase/functions/claim-deal/index.ts` | Create a claim with token + short_code; enforces rate limits |
| `redeem-token` | `supabase/functions/redeem-token/index.ts` | Business redeems by short_code or token |
| `begin-visual-redeem` | `supabase/functions/begin-visual-redeem/index.ts` | Start visual redemption timer (~15s) |
| `complete-visual-redeem` | `supabase/functions/complete-visual-redeem/index.ts` | Complete visual redemption after timer |
| `cancel-visual-redeem` | `supabase/functions/cancel-visual-redeem/index.ts` | Stub: visual redeem cannot be canceled |
| `finalize-stale-redeems` | `supabase/functions/finalize-stale-redeems/index.ts` | Auto-finalize stuck visual redemptions |
| `delete-user-account` | `supabase/functions/delete-user-account/index.ts` | Delete auth user (blocked if business owner) |
| `ingest-analytics-event` | `supabase/functions/ingest-analytics-event/index.ts` | Insert analytics event (allowlisted names) |

### API Wrappers

**`lib/functions.ts`** — main edge function wrappers:

| Function | Edge Function | Purpose |
|----------|--------------|---------|
| `claimDeal(dealId, extra?)` | `claim-deal` | Claim a deal, returns token + short_code |
| `redeemToken({ token?, short_code? })` | `redeem-token` | Business redeems a claim |
| `beginVisualRedeem(claimId)` | `begin-visual-redeem` | Start visual redemption |
| `completeVisualRedeem(claimId)` | `complete-visual-redeem` | Complete visual redemption |
| `cancelVisualRedeem(claimId)` | `cancel-visual-redeem` | Cancel visual redemption (stub) |
| `finalizeStaleRedeems()` | `finalize-stale-redeems` | Auto-finalize stuck redeems |
| `deleteUserAccount()` | `delete-user-account` | Delete user account |
| `aiGenerateDealCopy(body)` | `ai-generate-deal-copy` | Text-only AI deal copy |
| `aiCreateDeal(body)` | `ai-create-deal` | Legacy one-shot AI + insert |

**`lib/ai-compose-offer.ts`** — AI compose wrappers:

| Function | Edge Function | Purpose |
|----------|--------------|---------|
| `aiComposeOfferTranscribe(body)` | `ai-compose-offer` | Voice transcription only |
| `aiComposeOfferGenerate(body)` | `ai-compose-offer` | Full AI compose (text + image) |
| `fetchAiComposeQuota(businessId)` | RPC `ai_compose_quota_status` | Check AI usage quota |

**Direct Supabase client calls** (no wrapper): Deals CRUD, businesses CRUD, favorites, deal_claims queries, deal_templates, consumer_profiles, storage uploads — all done inline via `supabase.from(...)` in screen components.

### Data Flow: Deal Creation (Quick Deal)

1. **User input** → `app/create/quick.tsx`: title, offer hint, price, end time, max claims, cutoff minutes
2. **Optional AI suggestion** → `aiGenerateDealCopy()` → Edge `ai-generate-deal-copy` → OpenAI chat → returns title/promo/description → sets title state
3. **Client-side validation**:
   - `assessDealQuality()` (`lib/deal-quality.ts`) — checks title length, % thresholds, BOGO patterns, i18n patterns
   - `validateStrongDealOnly()` (`lib/strong-deal-guard.ts`) — free item, conditional discount, percent floor, strong language checks
4. **Insert** → `supabase.from("deals").insert({...})` — direct client call (no edge function)
5. **Server-side validation** → Postgres trigger `trg_enforce_strong_deal_only_guardrail` fires `enforce_strong_deal_only_guardrail()` — mirrors client-side strong deal check
6. **Redirect** → `router.replace("/(tabs)/dashboard")`

---

## Section 3: Database Schema

### Tables

#### 1. `businesses`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `uuid_generate_v4()` |
| `owner_id` | UUID FK → `auth.users(id)` | ON DELETE CASCADE, **UNIQUE** |
| `name` | TEXT NOT NULL | |
| `category` | TEXT | e.g. "Coffee shop" |
| `tone` | TEXT | e.g. "Friendly" |
| `location` | TEXT | City/area description |
| `short_description` | TEXT | AI context |
| `preferred_locale` | TEXT | en/es/ko |
| `latitude` | DOUBLE PRECISION | WGS84 |
| `longitude` | DOUBLE PRECISION | WGS84 |
| `phone` | TEXT | |
| `hours_text` | TEXT | |
| `contact_name` | TEXT | |
| `business_email` | TEXT | |
| `address` | TEXT | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**RLS:** Anyone can read. Owner can insert/update own.

#### 2. `deals`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `business_id` | UUID FK → `businesses(id)` | ON DELETE CASCADE |
| `title` | TEXT NOT NULL | |
| `description` | TEXT | |
| `price` | DECIMAL(10,2) | |
| `start_time` | TIMESTAMPTZ NOT NULL | |
| `end_time` | TIMESTAMPTZ NOT NULL | |
| `claim_cutoff_buffer_minutes` | INTEGER NOT NULL | DEFAULT 15 |
| `max_claims` | INTEGER NOT NULL | DEFAULT 100 |
| `is_active` | BOOLEAN | DEFAULT true |
| `poster_url` | TEXT | Signed or public URL |
| `poster_storage_path` | TEXT | Storage bucket path |
| `ad_url` | TEXT | Unused |
| `quality_tier` | TEXT | "strong"/"acceptable"/"weak" |
| `is_recurring` | BOOLEAN | |
| `days_of_week` | INTEGER[] | 1=Mon..7=Sun |
| `window_start_minutes` | INTEGER | Minutes from midnight |
| `window_end_minutes` | INTEGER | Minutes from midnight |
| `timezone` | TEXT | DEFAULT 'America/Chicago' |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**RLS:** Anyone reads active deals. Users read deals they claimed. Owner CRUD.  
**Trigger:** `trg_enforce_strong_deal_only_guardrail` — BEFORE INSERT/UPDATE on title/description.  
**Indexes:** `idx_deals_business_id`, `idx_deals_end_time`, `idx_deals_is_active`.

#### 3. `deal_claims`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `deal_id` | UUID FK → `deals(id)` | ON DELETE CASCADE |
| `user_id` | UUID FK → `auth.users(id)` | ON DELETE CASCADE |
| `token` | TEXT UNIQUE NOT NULL | Full redemption token |
| `short_code` | TEXT | 6-char code, partial unique index |
| `expires_at` | TIMESTAMPTZ NOT NULL | |
| `redeemed_at` | TIMESTAMPTZ | |
| `claim_status` | TEXT NOT NULL | CHECK: active/redeeming/redeemed/expired/canceled |
| `redeem_started_at` | TIMESTAMPTZ | Visual redeem start |
| `redeem_method` | TEXT | CHECK: visual/qr/NULL |
| `grace_period_minutes` | INTEGER NOT NULL | DEFAULT 10 |
| `acquisition_source` | TEXT | |
| `age_band_at_claim` | TEXT | |
| `zip_at_claim` | TEXT | |
| `location_source_at_claim` | TEXT | |
| `app_version_at_claim` | TEXT | |
| `device_platform_at_claim` | TEXT | |
| `session_id_at_claim` | TEXT | |
| `created_at` | TIMESTAMPTZ | |

**RLS:** User reads/inserts own. Business reads/updates via `deal_claim_visible_to_business_owner()`.  
**Indexes:** Multiple on deal_id, user_id, token, expires_at, redeemed_at, short_code.

#### 4. `favorites`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | UUID FK → `auth.users(id)` | ON DELETE CASCADE |
| `business_id` | UUID FK → `businesses(id)` | ON DELETE CASCADE |
| `created_at` | TIMESTAMPTZ | |

**UNIQUE:** `(user_id, business_id)`. **RLS:** User reads/inserts/deletes own.

#### 5. `deal_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | `gen_random_uuid()` |
| `business_id` | UUID FK → `businesses(id)` | ON DELETE CASCADE |
| `title` | TEXT | |
| `description` | TEXT | |
| `price` | DECIMAL | |
| `poster_url` | TEXT | |
| `max_claims` | INTEGER NOT NULL | DEFAULT 50 |
| `claim_cutoff_buffer_minutes` | INTEGER NOT NULL | DEFAULT 15 |
| `is_recurring` | BOOLEAN | |
| `days_of_week` | INTEGER[] | |
| `window_start_minutes` | INTEGER | |
| `window_end_minutes` | INTEGER | |
| `created_at` | TIMESTAMPTZ | |

**RLS:** Owner CRUD.

#### 6. `ai_generation_logs`

Tracks AI compose usage. Full columns defined in migration `20260325120000`. FK to `businesses`, self-referential `duplicate_of_log_id`, `published_deal_id` → `deals`.

**RLS:** Enabled, **no policies defined** — only accessible via service role. This is intentional.

#### 7. `consumer_profiles`

| Column | Type | Notes |
|--------|------|-------|
| `user_id` | UUID PK FK → `auth.users` | ON DELETE CASCADE |
| `zip_code` | TEXT NOT NULL | |
| `age_range` | TEXT | CHECK constraint, nullable |
| `gender` | TEXT | CHECK constraint |
| `birthdate` | DATE | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**RLS:** User reads/inserts/updates own.

#### 8. `app_analytics_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `event_name` | TEXT | |
| `occurred_at` | TIMESTAMPTZ | |
| `user_id` | UUID FK → `auth.users` | ON DELETE SET NULL |
| `business_id` | UUID FK → `businesses` | |
| `deal_id` | UUID FK → `deals` | |
| `claim_id` | UUID FK → `deal_claims` | |
| `context` | JSONB | DEFAULT `{}` |
| `app_version` | TEXT | |
| `device_platform` | TEXT | |

**RLS:** INSERT own `user_id` only.

### PostgreSQL Functions (RPC)

| Function | Returns | Purpose |
|----------|---------|---------|
| `ai_compose_quota_status(p_business_id)` | TABLE(used_count, monthly_limit) | AI usage quota check |
| `merchant_deal_insights(p_deal_id)` | JSONB | Per-deal analytics |
| `merchant_business_insights(p_business_id)` | JSONB | Business-wide analytics |
| `is_strong_deal_offer(p_title, p_description)` | BOOLEAN | Deal validation |
| `enforce_strong_deal_only_guardrail()` | TRIGGER | Rejects weak deals on insert/update |
| `deal_claim_visible_to_business_owner(p_deal_id)` | BOOLEAN | RLS helper |

### Schema Issues

- **`deals.ad_url`**: Column exists from initial schema but is never written to or read from in any code. Orphaned column.
- **`ai_generation_logs`**: Has RLS enabled but **zero policies**. Accessible only via service role, which is correct but should be documented.
- **No index on `deals.business_id` + `is_active`**: Composite index would help the main feed query.
- **`deal_templates.poster_url`** stores signed URLs that **expire** (created in `ai.tsx` line 367 with 1-year expiry). After a year, template poster URLs will be dead.

---

## Section 4: Screen-by-Screen Inventory

### Consumer Screens

| Screen | File | Status | Notes |
|--------|------|--------|-------|
| Auth Landing | `app/auth-landing.tsx` | Working | Hardcoded demo credentials (lines 73-74). `style?: any` cast (line 44). |
| Onboarding | `app/onboarding.tsx` | Working | Empty `catch {}` blocks for GPS errors (lines 96-98, 128-130). Hardcoded English "Continue" (line 259). Hardcoded `#b45309` color (line 194). |
| Consumer Profile Setup | `app/consumer-profile-setup.tsx` | Working | Hardcoded border colors (lines 175-176). |
| Discovery Feed | `app/(tabs)/index.tsx` | Working | 819 lines. Hardcoded English: "No live deals nearby" (line 575), "Your penguin scout" (line 578). `formatTimeLeft` returns "Xh Xm left" not i18n (lines 451-452). Unsplash fallback image URL (line 628). |
| Deal Detail | `app/deal/[id].tsx` | Working | Redirects to auth if logged out. No useEffect cancellation on favorite load (lines 109-120). |
| Map | `app/(tabs)/map.native-impl.tsx` | Working | Hardcoded `DALLAS_FALLBACK` coordinates (line 64). `console.warn` on line 130. |
| Wallet | `app/(tabs)/wallet.tsx` | Working | 748 lines. Hardcoded English: "Redeem soon" (line 410), "Scan QR at counter" (line 512), "QR fallback -" concatenation (line 547). |
| Favorites | `app/(tabs)/favorites.tsx` | Working | Hidden tab (`href: null`). Raw `error.message` in banner (lines 75, 97). |
| Settings | `app/(tabs)/settings.tsx` | Working | Silent `catch { /* ignore */ }` when GPS fails (lines 101-103). |
| Business Detail | `app/business/[id].tsx` | Working | Redirects to auth if logged out. |
| Forgot Password | `app/forgot-password.tsx` | Working | Minimal `catch {}` (lines 39-40). |
| Reset Password | `app/reset-password.tsx` | Working | |

### Business Screens

| Screen | File | Status | Notes |
|--------|------|--------|-------|
| Business Setup | `app/business-setup.tsx` | Working | Hardcoded English success (line 96). Unused `sessionEmail` destructure (line 21). |
| Dashboard | `app/(tabs)/dashboard.tsx` | Working | 735 lines. Full analytics + deal management. |
| Create Hub | `app/(tabs)/create.tsx` | Partial | `templates` typed `any[]` (line 23). `banner` state is set but **never displayed** — dead code. Silent error on template fetch (lines 60-62). |
| Quick Deal | `app/create/quick.tsx` | Working | Hardcoded English subtitle: "Built for speed..." (line 200). |
| AI Ad Creation | `app/create/ai.tsx` | Working | 1447 lines — largest file. Multiple `catch (err: any)` blocks (lines 505, 683). QA validation panel included. Dev-only tools. |
| AI Compose | `app/create/ai-compose.tsx` | Working | Hardcoded English: "Tap once to choose from gallery" (line 372), "Step 1 of 2" (line 345), "Step 2 of 2" (line 388), "AI left" (line 279). |
| Reuse Templates | `app/create/reuse.tsx` | Working | Second query error overwrites first (lines 57-59). |
| Redeem (Merchant) | `app/(tabs)/redeem.tsx` | Working | Camera + manual short code entry. |
| Deal Analytics | `app/deal-analytics/[id].tsx` | Working | `bestTime` period logic is simplistic (lines 117-129). |
| Account | `app/(tabs)/account.tsx` | Working | 1035 lines. Many hardcoded English strings (lines 455-458, 567-582, 658-659, 848-880). `any` casts (lines 342, 390). |

### Other

| Screen | File | Status | Notes |
|--------|------|--------|-------|
| Debug Diagnostics | `app/debug-diagnostics.tsx` | Working | Dev-only JSON dump |
| Modal | `app/modal.tsx` | Stub | Template modal, not used in production |
| Explore | `app/(tabs)/explore.tsx` | Stub | Just re-exports auth tab (3 lines) |

---

## Section 5: Deal Creation Flow (Detailed)

### Quick Deal Path (`app/create/quick.tsx`)

**Steps:**

1. Owner enters **Offer Hint** (what the deal is, e.g. "Buy a latte, get a muffin free")
2. Optional: tap **"Suggest title (AI)"** → calls `aiGenerateDealCopy()` → sets title from AI response
3. Owner enters/edits **Title** (the one consumers see)
4. Optional: **Price** (decimal)
5. **End Time** via DateTimePicker (default: 2 hours from now)
6. **Max Claims** (default: 50)
7. **Cutoff Minutes** (default: 15 — claims stop this many minutes before end)
8. Tap **Publish**

**Validation chain on publish:**

1. Client: `assessDealQuality()` — checks title length (≥8 chars), percent thresholds (≥40%), BOGO/2-for-1 patterns (EN/ES/KO), bundle pricing patterns. If `blocked === true`, shows translated error.
2. Client: `validateStrongDealOnly()` — checks free item patterns, conditional discount rejection, percent floor (<40%), strong language requirement. If `ok === false`, shows warning.
3. Server: `supabase.from("deals").insert(...)` — direct insert, no edge function.
4. Server: Postgres trigger `trg_enforce_strong_deal_only_guardrail` — mirrors strong-deal check server-side. Raises exception if deal is weak.

**API calls:** `aiGenerateDealCopy` (optional, edge function) + `deals` table insert (direct).

**State:** All local `useState`. No form library. No draft persistence — if the user navigates away, everything is lost.

### AI Ad Creation Path (`app/create/ai.tsx`)

**Steps:**

1. Take/pick **photo** → uploaded to `deal-photos` Supabase storage bucket
2. Enter **hint text** (what the deal is)
3. Optional: **price**
4. Choose **validity**: one-time (start/end datetime) or recurring (days of week + time window)
5. Set **max claims** and **cutoff buffer**
6. Tap **"Generate 3 AI Ad Ideas"** → calls `ai-generate-ad-variants` edge function
7. Receive 3 ad variants (value/neighborhood/premium lanes)
8. Select one → populates draft editor (title, promo line, CTA, description)
9. Edit draft fields
10. Tap **Publish** or **Save as Template**

**Regeneration:** Max 2 regenerations per draft session (`MAX_REGENERATIONS_PER_DRAFT = 2`, line 104). Client-enforced — not validated server-side beyond `regeneration_attempt` parameter.

**Template save:** Inserts into `deal_templates` table with all fields including poster URL (which is a signed URL — **will expire**).

**AI edge function (`ai-generate-ad-variants`):**
- Receives: `business_id`, `photo_path`, `hint_text`, optional `price`, `business_context`, `regeneration_attempt`, `offer_schedule_summary`, `output_language`, `manual_validation_tag`
- Gets signed URL for photo from storage
- Sends to OpenAI: photo + structured prompt requesting 3 JSON ad variants
- Returns: `{ ads: [GeneratedAd, GeneratedAd, GeneratedAd] }`
- Demo mode: returns hardcoded variants for `demo@demo.com` when no OPENAI_API_KEY

**Deal quality on publish:** Same dual validation as Quick Deal (`assessDealQuality` + `validateStrongDealOnly`).

### AI Compose Path (`app/create/ai-compose.tsx`)

**Steps:**

1. Pick **image** from gallery (with base64)
2. Enter **text prompt** and/or use **voice recording** (mic button)
3. Voice → `aiComposeOfferTranscribe()` → edge `ai-compose-offer` (Whisper transcription) → appends to prompt
4. Tap **Generate** → `aiComposeOfferGenerate()` → edge `ai-compose-offer` → returns `recommended_offer` + 2 `ad_variants` (multilingual: en/es/ko)
5. Pick a variant → navigates to `/create/quick` with prefilled title + hint

**Quota/limits:**
- Monthly quota: 30 generations (configurable via `AI_MONTHLY_LIMIT` env)
- Cooldown between calls: configurable via `AI_COOLDOWN_SECONDS`
- Deduplication: same content within `AI_DEDUP_WINDOW_SECONDS` returns cached result
- Quota check: `fetchAiComposeQuota()` calls RPC `ai_compose_quota_status`

### Deal Templates

- Created via **Save as Template** button on AI creation screen
- Stored in `deal_templates` table with title, description, price, poster_url, max_claims, cutoff, recurring config
- Loaded in `app/create/reuse.tsx` and `app/(tabs)/create.tsx`
- When selected: navigates to `app/create/ai.tsx?templateId=...` which pre-fills all fields
- **Issue:** `poster_url` in templates stores signed URLs that expire after 1 year

### Deal Scheduling

- **One-time:** `start_time` + `end_time` (both TIMESTAMPTZ)
- **Recurring:** `is_recurring=true`, `days_of_week` (1-7), `window_start_minutes` / `window_end_minutes` (minutes from midnight), `timezone`
- For recurring deals, `end_time` is set to 30 days in the future (line 617 in ai.tsx)
- Active window checking: `isDealActiveNow()` in `lib/deal-time.ts`
- Claim validation for recurring deals: handled in `claim-deal` edge function

### AI Ad Generation End-to-End

1. Client uploads photo to `deal-photos` bucket → gets `photo_path`
2. Client calls `ai-generate-ad-variants` with photo_path, hint, context
3. Edge function creates signed URL for photo (1-year expiry)
4. Edge function sends to OpenAI `POST /v1/chat/completions` with:
   - Model: `resolveOpenAiChatModel()` (default `gpt-4o-mini`, allowlist: `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`)
   - Image URL + structured JSON schema requesting 3 ad variants
   - Each variant: `headline`, `subheadline`, `cta`, `style_label`, `rationale`, `visual_direction`, `creative_lane`
5. Response parsed, validated (must have exactly 3 lanes)
6. Client displays cards; user picks one
7. On publish: photo path stored as `poster_storage_path`, public URL built as `poster_url`

### DALL-E Poster Generation

**Not implemented.** There is no DALL-E integration anywhere in the codebase. The `visual_direction` field on ad variants is described as "Notes for future image gen; may be empty" (line 17, `lib/ad-variants.ts`). Poster images are owner-uploaded photos, not AI-generated.

### Deal Quality Validation

**`assessDealQuality()` in `lib/deal-quality.ts`:**
- Title must be ≥8 characters
- Multiple distinct percentages without a structural primary offer → blocked
- Matches BOGO/2-for-1/half-off/50%+/free-item/bundle patterns (EN/ES/KO) → strong
- End-of-day or clearance with value context → strong
- Single percentage ≥40% → acceptable
- Single percentage <40% → blocked
- Bundle/fixed-price patterns → acceptable
- Combined text <14 chars → blocked ("clarify value")
- Everything else → blocked

**`validateStrongDealOnly()` in `lib/strong-deal-guard.ts`:**
- Free item (excluding "sugar-free" etc.) → pass
- Conditional discount ("buy X + N% off Y") → reject
- Any explicit percentage <40% → reject
- Strong language (BOGO, 2-for-1, ≥40% off, etc.) → pass
- No strong language → reject

**Server mirror:** `is_strong_deal_offer()` PostgreSQL function + trigger (`20260401150000` migration). Same logic in SQL.

---

## Section 6: Consumer Flow (Detailed)

### Auth/Signup Flow

1. Cold start: `app/index.tsx` signs out the current session and redirects to `/auth-landing`
2. `app/auth-landing.tsx`: Email + password form
   - **Sign In:** `supabase.auth.signInWithPassword()`
   - **Sign Up:** `supabase.auth.signUp()` with email confirmation disabled (immediate sign-in)
   - On success: redirects to `next` param or `/onboarding`
   - Demo account: hardcoded `demo@demo.com` / `123456` (lines 73-74)
   - Error handling: `friendlyError()` maps Supabase auth errors to readable messages via `friendlyAuthErrorMessage()` in `lib/auth-error-messages.ts`
3. Password recovery: `/forgot-password` → sends email → deep link → `/reset-password`

**Issue:** The app **always signs out on launch** (`app/index.tsx` line 26-28). This is by design per a code comment, but means users must log in every time they open the app.

### Onboarding

`app/onboarding.tsx` has 5 steps:

1. **Language:** Pick en/es/ko → sets i18n locale + persists to AsyncStorage
2. **Location:** Request GPS permission → if denied, fall back to ZIP
3. **ZIP Code:** 5-digit US ZIP → geocoded via `geocodeUsZip()` (local lookup table in `lib/us-zip-geocode.ts`, not an API call)
4. **Radius:** Slider 1-10 miles (default 3)
5. **Notifications:** Request permission via `expo-notifications`

**Completeness:** The onboarding is functional but has gaps:
- Step 0 "Continue" button text is hardcoded in English (line 259)
- GPS errors are silently caught (lines 96-98)
- ZIP geocode errors show a generic hint (lines 128-130)
- No back button between steps
- No skip option for location/notifications

### Discovery Feed (`app/(tabs)/index.tsx`)

**Data fetching:**
- `deals` table: `is_active=true` AND `end_time >= now`, ordered by `end_time ASC`, limit 80
- Filtered by `isDealActiveNow()` for recurring deal window check
- `businesses` table: all, ordered by name, limit 300
- `favorites` table: user's favorites
- User claims: `deal_claims` for visible deal IDs

**Sorting:**
1. Favorites first
2. By distance (haversine) if user location available
3. By end_time (soonest first)

**Filtering:**
- Text search via `dealMatchesSearch()` (title, description, business name)
- Radius filter: deals from businesses within `radiusMiles` (default 3) OR from favorited businesses
- "Favorites only" toggle
- "Show all live deals" button when nearby deals are empty

**Display:** Hero-style cards with poster image (Unsplash fallback), business name, BOGO title, distance, time remaining, claim button.

### Map (`app/(tabs)/map.native-impl.tsx`)

- Uses `react-native-maps` (MapView)
- Shows business markers with live deal indicator (green dot)
- Centers on user location or DFW fallback (32.8998, -96.9894)
- Mode toggle: businesses vs deals
- Platform-specific files: `map.android.tsx`, `map.ios.tsx`, `map.tsx` all re-export `map.native-impl.tsx`
- Web stub: `lib/stubs/react-native-maps.web.tsx`

**Known issues:** Hardcoded Dallas fallback coordinates (line 64). `console.warn` on line 130.

### Wallet and Claiming (`app/(tabs)/wallet.tsx`)

**Claim flow:**
1. Consumer taps "Claim" on deal card → `claimDeal(dealId)` → edge `claim-deal`
2. Edge function validates: auth, deal exists, deal active, not past cutoff, not sold out, rate limits (1/hour, 1/business/day, 1 active per business), daily limit
3. Returns: `claim_id`, `token`, `expires_at`, `short_code`
4. Consumer sees QR modal with token

**Rate limits enforced in `claim-deal`:**
- 1 claim per hour (across all deals)
- 1 active claim per business
- 1 claim per business per day
- Max claims per deal (`deal.max_claims`)

**Visual redemption flow:**
1. Consumer taps "Use this deal" on active claim → shows slide-to-confirm sheet
2. Slide confirmed → `beginVisualRedeem(claimId)` → sets `claim_status=redeeming`, starts ~15s timer
3. Full-screen visual pass shown (green, animated) → `WalletVisualPassModal` component
4. After timer: `completeVisualRedeem(claimId)` → marks `redeemed`
5. Staff sees the visual pass and confirms

**QR redemption flow:**
1. Consumer shows QR code from wallet
2. Business owner scans with `app/(tabs)/redeem.tsx` or enters short code manually
3. `redeemToken({ short_code })` → edge `redeem-token` → validates ownership → marks redeemed

**Countdown:** Real-time countdown on active claims using `useSecondTick()` (1-second interval). Urgent styling when <15 minutes remaining.

### Favorites

- Stored in `favorites` table (user_id + business_id)
- Toggle via direct `supabase.from("favorites").insert/delete`
- Affects feed: favorited businesses always shown regardless of radius
- Affects sorting: favorited businesses sorted first
- Affects notifications: `syncConsumerDealNotifications()` called when favorites change
- Hidden "Favorites" tab exists at `app/(tabs)/favorites.tsx` but `href: null` in tab layout

---

## Section 7: AI Features Inventory

### Edge Functions

| Function | Model | Prompt Summary | Returns | Limits | Error Handling |
|----------|-------|---------------|---------|--------|----------------|
| `ai-compose-offer` | `resolveOpenAiChatModel()` (default `gpt-4o-mini`) + Whisper (`whisper-1`) | Compose promotional offer from text/image/voice; structured JSON with recommended_offer + 2 ad_variants (multilingual) | `{ ok, result: { recommended_offer, ad_variants }, quota }` | 30/month, cooldown, dedup | Quota, cooldown, dedup codes; OPENAI_ERROR/PARSE_ERROR as 502 |
| `ai-generate-ad-variants` | `resolveOpenAiChatModel()` | 3 ad concepts (value/neighborhood/premium) from image + text + business context | `{ ads: [3 variants] }` | 2 regenerations per draft (client-enforced) | Demo fallback when no API key; 429 for regen limit |
| `ai-generate-deal-copy` | **BUG: `CHAT_MODEL` is undefined** (see bugs section) | Short deal copy (title ≤50, promo ≤60, description ≤160) from hint text | `{ title, promo_line, description }` | None | 401/400/500 |
| `ai-create-deal` | `resolveOpenAiChatModel()` | Legacy: AI copy from photo + auto-insert deal | `{ deal_id, title, description, promo_line, poster_url }` | None | Strong-deal guard validation |

### Client Wrappers

| Function | File | Edge Function |
|----------|------|--------------|
| `aiGenerateDealCopy()` | `lib/functions.ts:182` | `ai-generate-deal-copy` |
| `aiCreateDeal()` | `lib/functions.ts:220` | `ai-create-deal` |
| `aiComposeOfferTranscribe()` | `lib/ai-compose-offer.ts:69` | `ai-compose-offer` (transcribe_only) |
| `aiComposeOfferGenerate()` | `lib/ai-compose-offer.ts:92` | `ai-compose-offer` |
| `fetchAiComposeQuota()` | `lib/ai-compose-offer.ts:131` | RPC `ai_compose_quota_status` |

### Token/Cost Tracking

- **AI usage is logged** in `ai_generation_logs` table (by `ai-compose-offer` edge function only)
- Columns: `business_id`, `user_id`, `prompt_hash`, `prompt_text`, `response_json`, `tokens_used`, `model_name`, `created_at`
- **Only `ai-compose-offer` logs usage.** The other AI functions (`ai-generate-ad-variants`, `ai-generate-deal-copy`, `ai-create-deal`) do **not** log token usage or costs.
- No centralized cost dashboard or billing tracking

### Rate Limiting

| Limit | Where Enforced | Status |
|-------|---------------|--------|
| 30 generations/month per business | `ai-compose-offer` edge function (reads `ai_generation_logs`) | Implemented |
| Cooldown between AI calls | `ai-compose-offer` edge function | Implemented |
| Deduplication window | `ai-compose-offer` edge function (hash matching) | Implemented |
| 2 regenerations per draft | `app/create/ai.tsx` line 104, client-side only | Implemented (client only) |
| Transcription cooldown | `ai-compose-offer` edge function | Implemented |

**Gap:** The 30/month limit only applies to `ai-compose-offer`. The `ai-generate-ad-variants` function has no monthly limit — unlimited OpenAI calls.

---

## Section 8: Known Bugs and Issues

### Critical Bugs

1. **`ai-generate-deal-copy` uses undefined `CHAT_MODEL`** — `supabase/functions/ai-generate-deal-copy/index.ts` line 107: `model: CHAT_MODEL`. The variable `CHAT_MODEL` is never defined. The function imports `resolveOpenAiChatModel` (line 3) but never calls it. This edge function **will crash at runtime** when invoked for non-demo users. The client wrapper `aiGenerateDealCopy()` in `lib/functions.ts:182` will throw.

2. **App signs out on every launch** — `app/index.tsx` lines 26-28: `supabase.auth.signOut()` is called unconditionally on cold start. Users cannot stay logged in across app restarts. This may be intentional for development but is a terrible UX for production.

### Silent Error Swallowing

| File | Line(s) | Context |
|------|---------|---------|
| `app/onboarding.tsx` | 96-98 | GPS error: user sees generic hint only |
| `app/onboarding.tsx` | 128-130 | ZIP geocode error: same |
| `app/(tabs)/settings.tsx` | 101-103 | GPS error: `catch { /* ignore */ }` — no user feedback |
| `lib/supabase.ts` | 36-37, 51-52, 67-68 | Web localStorage errors: silent fallback to memory |
| `lib/tab-mode.tsx` | 48, 59, 64, 102 | SecureStore errors: silent |
| `lib/functions.ts` | 28, 146-148 | JSON parse error, stale redeems: `catch { /* ignore */ }` |
| `lib/consumer-preferences.ts` | 46 | Preference load error: silent |
| `lib/consumer-location.ts` | 44 | Location resolve error: silent |
| `lib/deal-poster-url.ts` | 30 | URL construction error: silent |
| `lib/notifications.ts` | 25, 41 | Notification sync errors: silent |
| `lib/app-analytics.ts` | 48 | Analytics error: silent (acceptable) |
| `lib/analytics.ts` | 21 | Analytics sink error: silent (acceptable) |
| `lib/merchant-insights.ts` | 21 | Insights parse error: silent |
| `lib/format-deal-expiry.ts` | 12 | Format error: silent |
| `lib/runtime-env.ts` | 65 | Env resolution error: silent |
| `lib/ai-compose-offer.ts` | 112 | JSON parse error: silent |
| `components/notification-deeplink-handler.tsx` | 61 | Deep link handling error: silent |

### Hardcoded Values That Should Be Configurable

| File | Line | Value | Should Be |
|------|------|-------|-----------|
| `app/create/quick.tsx` | 200 | `"Built for speed: complete this flow in under a minute."` | i18n key |
| `app/(tabs)/index.tsx` | 575 | `"No live deals nearby right now - check back soon!"` | i18n key |
| `app/(tabs)/index.tsx` | 578 | `"Your penguin scout is still waddling for offers."` | i18n key |
| `app/(tabs)/index.tsx` | 628 | Unsplash fallback image URL | Config constant or asset |
| `app/(tabs)/wallet.tsx` | 410 | `"Redeem soon"` | i18n key |
| `app/(tabs)/wallet.tsx` | 512 | `"Scan QR at counter"` | i18n key |
| `app/(tabs)/wallet.tsx` | 547 | `"QR fallback -"` concatenation | i18n template |
| `app/create/ai-compose.tsx` | 345 | `"Step 1 of 2"` | i18n key |
| `app/create/ai-compose.tsx` | 388 | `"Step 2 of 2"` | i18n key |
| `app/create/ai-compose.tsx` | 279 | `"AI left"` (quota display) | i18n key |
| `app/create/ai-compose.tsx` | 372 | `"Tap once to choose from gallery"` | i18n key |
| `app/(tabs)/map.native-impl.tsx` | 64 | Dallas fallback coordinates `(32.8998, -96.9894)` | Config constant |
| `app/(tabs)/account.tsx` | Multiple (455-880) | Many English strings in business profile section | i18n keys |
| `app/business-setup.tsx` | 96 | English success message | i18n key |
| `app/create/ai.tsx` | 60-68 | `SCHEDULE_DAY_BY_VALUE` English labels | i18n (sent to AI, so English is intentional) |
| `app/onboarding.tsx` | 194 | `#b45309` color | Theme constant |

### Missing Loading/Error States

- `app/(tabs)/create.tsx`: Template load failure is silent (lines 60-62) — no error banner shown to user
- `app/create/reuse.tsx`: If both queries fail, only the second error is shown (lines 57-59)
- `app/(tabs)/create.tsx`: `banner` state is set but **never rendered** in JSX — dead code

### Navigation Issues

- `app/(tabs)/explore.tsx` re-exports `./auth` — navigating to "Explore" tab just shows auth redirect. This tab appears to be a placeholder.
- `app/modal.tsx` is a template modal with a link home — not connected to any flow.

### TypeScript Issues

- `app/(tabs)/create.tsx` line 23: `templates` typed as `any[]`
- `app/auth-landing.tsx` line 44: `style?: any` parameter
- `app/(tabs)/account.tsx` lines 342, 390: `any` casts
- `app/business-setup.tsx` line 21: `sessionEmail` destructured but never used

### Console Warnings

- `app/(tabs)/map.native-impl.tsx` line 130: `console.warn` for map region errors
- `lib/app-analytics.ts` lines 42, 46: `console.warn` for analytics errors (dev only)

### Security Concerns

- **Hardcoded demo credentials** in `app/auth-landing.tsx` lines 73-74: `demo@demo.com` / `123456`. This is likely dev-only but is in production code.
- **No RLS policies on `ai_generation_logs`**: Intentional (service role only), but a developer could accidentally query this table from the client.
- **`deals` insert is direct from client**: The strong-deal guardrail trigger on the server catches weak deals, but the insert itself goes through the Supabase client (not an edge function). An attacker could potentially insert deals with manipulated fields (e.g., `quality_tier`, `poster_url`) if they have a valid session.
- **Signed URLs expire**: Poster URLs stored in `deal_templates.poster_url` and old `deals.poster_url` entries use 1-year signed URLs. There's a `poster_storage_path` column and `buildPublicDealPhotoUrl()` helper, but template URLs are still signed.

### TODO/FIXME/HACK Comments

**No `TODO`, `FIXME`, or `HACK` comments were found** in any `.ts` or `.tsx` file in the codebase.

---

## Section 9: What's Working vs What's Not

| Feature | Status | Notes |
|---------|--------|-------|
| Auth (email/password) | ✅ Working | Signs out on every app launch (intentional per code comment) |
| Consumer onboarding | ⚠️ Partial | Works but has i18n gaps, no back button between steps, silent GPS errors |
| Business onboarding | ✅ Working | Business setup form works, routes to deal creation |
| Deal creation (Quick) | ✅ Working | Title + basic fields → publish. AI suggest button may crash (see `CHAT_MODEL` bug) |
| Deal creation (AI compose) | ✅ Working | Photo + voice + text → AI offer → prefill quick deal |
| Deal templates | ✅ Working | Save/load from AI creation screen. Poster URLs will expire after 1 year. |
| Deal scheduling (one-time) | ✅ Working | Start/end datetime pickers |
| Deal scheduling (recurring) | ✅ Working | Days of week + time window. End time auto-set to 30 days out. |
| Recurring deals | ✅ Working | `isDealActiveNow()` checks window; `claim-deal` validates properly |
| AI ad copy generation | ⚠️ Partial | `ai-generate-deal-copy` has undefined `CHAT_MODEL` bug — will crash at runtime |
| AI ad variants (3-lane) | ✅ Working | Photo + context → 3 creative variants. Demo mode works without API key. |
| AI poster generation (DALL-E) | 🔲 Not Built | `visual_direction` field exists but no DALL-E integration |
| Discovery feed | ✅ Working | Location-based sorting, favorites, search, radius filter. Some i18n gaps. |
| Map | ✅ Working | Business/deal markers, user location, DFW fallback |
| Wallet/claiming | ✅ Working | Full claim → wallet → countdown → redeem flow |
| Redemption (QR) | ✅ Working | Business scans QR or enters short code via `redeem-token` |
| Redemption (visual) | ✅ Working | Slide-to-confirm → 15s timer → full-screen pass → auto-complete |
| Favorites | ✅ Working | Toggle on business cards, affects feed sorting and notifications |
| Notifications | ⚠️ Partial | Permission request works. `syncConsumerDealNotifications` exists but relies on `expo-notifications` local scheduling — no push notification server. |
| Analytics dashboard | ✅ Working | Business dashboard with metrics, deal list, insights RPC |
| Language selector | ✅ Working | en/es/ko in onboarding + settings. Many hardcoded English strings remain. |
| Demo mode | ✅ Working | `demo@demo.com` auto-login, hardcoded ad variants, seed scripts |
| Account deletion | ✅ Working | Edge function blocks if business owner, otherwise deletes auth user |
| Legal links | ✅ Working | Privacy policy, terms, support URLs configurable via env |

---

## Section 10: Recommendations for Next Developer

### Top 5 Things to Fix Immediately

1. **Fix `CHAT_MODEL` undefined in `ai-generate-deal-copy`** (`supabase/functions/ai-generate-deal-copy/index.ts` line 107). Add `const CHAT_MODEL = resolveOpenAiChatModel();` after the import. This edge function crashes on every invocation. The "Suggest title (AI)" button on the Quick Deal screen depends on it.

2. **Stop signing out on every app launch** (`app/index.tsx` lines 26-28). The `supabase.auth.signOut()` call forces re-login every time. Replace with a proper auth gate that checks session validity and only redirects to login when there's no valid session.

3. **Add i18n keys for all hardcoded English strings.** At least 15+ user-facing strings are hardcoded in English across the wallet, feed, onboarding, and create screens. The i18n infrastructure (i18next + es.json + ko.json) is already set up — the strings just need to be moved. Priority files: `wallet.tsx`, `index.tsx` (home), `ai-compose.tsx`, `quick.tsx`.

4. **Fix the dead `banner` state in `app/(tabs)/create.tsx`** (line 23). The `banner` state variable is set on error but never rendered in JSX. Template load failures are invisible to the user. Add `{banner ? <Banner message={banner.message} tone={banner.tone} /> : null}` to the render.

5. **Add error feedback for silent catches.** At minimum, `app/(tabs)/settings.tsx` line 101 (GPS failure) and `app/onboarding.tsx` lines 96-98 (GPS) and 128-130 (ZIP) should show the user an error or fallback message instead of silently failing.

### Top 5 Things to Build or Finish Next

1. **Push notifications server.** The current implementation uses `expo-notifications` for local scheduling only. There's no push notification server, no Supabase webhook, no way to notify consumers when a new deal is posted by a favorited business. This is table-stakes for a deals app.

2. **Persistent auth sessions.** Removing the forced sign-out on launch (item #1 above) isn't enough. Implement proper token refresh, session persistence across app restarts, and background session validation.

3. **DALL-E or AI poster generation.** The `visual_direction` field exists on every ad variant and the UI has placeholder space for it. Building the image generation pipeline would significantly improve the deal creation experience.

4. **Admin/moderation panel.** There's no way to moderate deals, manage businesses, view analytics across all merchants, or handle abuse reports. Even a simple Supabase dashboard view would help.

5. **Automated tests for edge functions.** There are Vitest tests for client-side logic (`deal-quality`, `strong-deal-guard`, `geo`, `us-zip`, `deals-discovery-filters`, `api-messages`, `deal-poster-url`) but **zero tests for any edge function**. The claim-deal rate limiting, visual redeem timing, and AI quota logic are all untested.

### Architecture Concerns / Tech Debt

- **No state management library.** Screens like `app/create/ai.tsx` (1447 lines, 30+ state variables) and `app/(tabs)/index.tsx` (819 lines) are doing too much. Extract shared state into a store (Zustand is a natural fit for this stack) or at minimum into custom hooks.

- **Direct Supabase queries scattered everywhere.** Deal fetching, business queries, favorites, and claims are all done inline in screen components. Extract these into a data access layer (`lib/queries.ts` or similar) for consistency, caching, and testability.

- **No optimistic updates or caching.** Every screen re-fetches all data on focus. There's no SWR, React Query, or any caching layer. For a deals app where freshness matters, this is acceptable short-term, but the UX would benefit from optimistic updates on favorites and claims.

- **`poster_url` signed URL expiration.** Deals and templates store signed URLs that expire. The `poster_storage_path` + `buildPublicDealPhotoUrl()` pattern is the correct solution, but not all code paths use it consistently. Templates always store signed URLs.

- **Two analytics systems.** `lib/analytics.ts` (dev console logging with `trackEvent`) and `lib/app-analytics.ts` (server-side via `ingest-analytics-event`). These serve different purposes but the naming overlap (`trackEvent` vs `trackAppAnalyticsEvent`) will confuse new developers.

### Files That Should Be Refactored or Split

| File | Lines | Why |
|------|-------|-----|
| `app/create/ai.tsx` | 1447 | Largest file. Extract: photo management, schedule config, ad variant display, draft editor, publish logic, template save into separate components/hooks. |
| `app/(tabs)/account.tsx` | 1035 | Mixes auth form, tab mode switching, business profile form, delete account, legal links. Split into sections or sub-screens. |
| `app/(tabs)/index.tsx` | 819 | Mixes deal feed, business list, favorites, QR modal, search, location. Extract deal card, business list, and data fetching into separate concerns. |
| `app/(tabs)/wallet.tsx` | 748 | Mixes claim list, countdown logic, visual redeem flow, QR modal. Extract visual redeem flow and claim card into components. |
| `app/(tabs)/dashboard.tsx` | 735 | Mixes metrics display, deal list, insights panel, end-deal logic. Extract each section. |

### Missing Tests or Validation

- **Zero edge function tests** — the entire server-side logic (claims, redemption, AI) is untested
- **No integration tests** — no test that verifies a deal can be created and claimed end-to-end
- **No UI component tests** — no tests for any React component
- **No E2E tests** — Playwright is in devDependencies but `scripts/screenshot-pages.mjs` suggests it's only used for screenshots
- **Client-side deal insert bypasses server validation** — while the Postgres trigger catches weak deals, other fields like `quality_tier` and `poster_url` are set by the client without server validation
- **No input sanitization** — deal titles and descriptions are stored as-is. No XSS prevention (React Native's Text component handles this, but web builds could be vulnerable)

---

*End of audit. This report reflects the codebase as of 2026-03-27. Line numbers reference current file contents and may shift with future edits.*
