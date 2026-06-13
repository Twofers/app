# Preview / development: demo account (turnkey)

> Obsolete for release review. The v1 app now uses a hard Shopper/Business role split and the
> old combined demo account must not be used for App Store or Play review. Use two dedicated
> reviewer accounts instead: one consumer account and one business account. This file remains
> only as historical preview-seed context.

EAS **preview** and **development** profiles set `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER=true` (see `eas.json`), which enables the in-app **Demo login** button. **Local `expo start`** also counts as a preview-like client (`__DEV__`), so **Demo login** appears even when that env var is unset. **Release bundles** (e.g. EAS production) require both a preview/dev profile (or `EXPO_PUBLIC_PREVIEW_MATCHES_DEV`) **and** `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER=true`. The app does **not** auto–sign-up the demo user after a failed password login (avoids email rate limits); provision the user once (below).

## Exact credentials

| Field | Value |
|--------|--------|
| Email | `demo@demo.com` |
| Password | `demo12345` |

Constants in code: `lib/demo-account.ts` (`DEMO_PREVIEW_EMAIL`, `DEMO_PREVIEW_PASSWORD`).

## How the auth user is created

1. **CLI (service role, recommended once per project):** `npm run seed:demo` creates `demo@demo.com` if missing and seeds the polished Cedar & Bean Cafe business + deals (`scripts/seed-demo.cjs`).
2. **Supabase Dashboard:** Manually create Auth user `demo@demo.com` with password `demo12345` (and confirm email if your project requires it).
3. **Manual sign-up:** On the **Create account** tab, a tester may `signUp` with `demo@demo.com` / `demo12345` once (sends confirmation email if enabled in Supabase). **Demo login** uses only `signInWithPassword` via `signInDemoPreviewUser` — no automatic `signUp` after failed login.

## How the demo business and deals are linked

**Automatic (recommended for testers):** After a successful demo sign-in, `ensureDemoCoffeePreview` runs (`lib/demo-preview-seed.ts`):

- If the user has **no** business row, it inserts **Cedar & Bean Cafe** with `owner_id = auth.uid()` (same fields as SQL seed).
- If a **legacy stub** exists (old demo business name, category `Demo`, or old `hello@demo.twofer.app` contact email), it **updates** the row to the canonical Grapevine cafe profile.
- It refreshes the demo business profile row to replace stale Account values such as `Met` / `E` with polished merchant-facing data.
- It replaces old seed/smoke-test deal titles with the canonical Cedar & Bean Cafe BOGO deal set using public Unsplash `poster_url` values (no storage upload).

**Operator reset (refreshes the canonical demo rows):** Run `npm run seed:demo` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, or run `supabase/seed_demo_coffee_business.sql` in the SQL Editor (user must exist first unless you used the CLI script, which creates the user).

**Claim state after `seed:demo` (matters for the owner-demo proof):** the CLI reset leaves the demo account **claim-clean** — two *redeemed* wallet-history claims backdated 1-2 days, and **no** active or same-day claim. This is deliberate: `supabase/functions/claim-deal` blocks a fresh claim if the user already has an active claim app-wide **or** any non-canceled claim on the same business on the same local day (America/Chicago). A same-day or active seed claim would block the very claim the smoke needs, so the proof creates the active ticket live. Because the demo account is both owner and shopper, it can claim Cedar **once per local day**; if you need to repeat the proof the same day without a re-seed, use a fresh throwaway shopper account for the claim and redeem it as the demo owner. See `docs/beta-release-checklist.md` -> "Next Smoke Setup".

## Exact steps for a clean preview test

1. Point the app at your Supabase project (`.env` / EAS secrets: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
2. Apply migrations (includes `deal-photos` public read if your project uses that).
3. Install a **preview** or **development** EAS build (or `npx expo start` for local dev — counts as preview-like).
4. Open the app → you should land on **auth** (no tabs before session).
5. Tap **Demo login** (or sign in with the table above).
6. Switch to **Business** tab mode if needed → **Create → AI ads** should show the demo business without a separate SQL step.

Optional for CI or resetting deals:  
`SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo`

## AI create-deal flow (main product path)

Path: **Create → AI ads** → upload/pick photo → hint → **Generate 3 ad ideas** → choose ad → **Publish**.

- **Demo account (`demo@demo.com`):** Edge function `ai-generate-ad-variants` uses **built-in template ads** when `OPENAI_API_KEY` is missing or when `AI_ADS_DEMO_USE_LIVE` is not `true` (see `supabase/functions/ai-generate-ad-variants/index.ts`). **Publishing** inserts into `deals` from the client and does **not** call OpenAI.
- **Live OpenAI for the demo email:** Set Supabase secrets `OPENAI_API_KEY` and `AI_ADS_DEMO_USE_LIVE=true`, redeploy `ai-generate-ad-variants`.
- **Dev-only “Test ai-create-deal” button** (`__DEV__` in `app/create/ai.tsx`): requires `OPENAI_API_KEY` on the `ai-create-deal` function.

### Verify secrets before testing AI

In Supabase Dashboard → **Project Settings → Edge Functions → Secrets** (or CLI):

- Always present for functions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (usually injected by Supabase).
- For real GPT ads: `OPENAI_API_KEY`.
- Optional: `AI_ADS_DEMO_USE_LIVE=true` to force live OpenAI for `demo@demo.com` in `ai-generate-ad-variants`.

Quick check: invoke `ai-generate-ad-variants` from the app with demo user; if secrets are wrong, the app surfaces the existing friendly errors from `create/ai.tsx`.

## Android maps

Set `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` for device maps (see `app.config.js` / EAS env).
