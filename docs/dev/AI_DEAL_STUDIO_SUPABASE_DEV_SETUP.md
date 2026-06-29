# AI Deal Studio Supabase Dev Setup

This setup is only for the local Android development APK:

- App name: `Twofer Dev`
- Android package: `com.unvmex2.twoforone.dev`
- Publishing: disabled by `EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING=true`
- Supabase target: production project `kvodhiqhdqnptqovovia` while publishing remains disabled

Do not put production secrets in Expo env files. The mobile app uses only public Supabase URL/anon key values; service-role and provider keys remain server-side.

## Phase 1: Local Environment

`.env.development.local` is ignored by Git through `.gitignore` entries for `.env.development.local` and `.env*.local`.

Create the local file:

```powershell
Copy-Item .\.env.development.local.example .\.env.development.local
```

Paste only the active Supabase URL and anon key into:

```text
C:\Users\unvme\Downloads\twoforone\.env.development.local
```

Fill these two lines with values from the active Supabase project:

```text
EXPO_PUBLIC_SUPABASE_URL=https://kvodhiqhdqnptqovovia.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
```

Keep the AI Studio dev flags enabled in that same local file:

```text
TWOFER_APP_VARIANT=ai-studio-dev
EXPO_PUBLIC_APP_VARIANT=ai-studio-dev
EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV=true
EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING=true
```

## Phase 2: Link Supabase CLI To Active Project

The repo may already have Supabase CLI link metadata from prior work, so verify the linked ref before any deploy.

From the repo root:

```powershell
supabase login
supabase projects list
supabase link --project-ref kvodhiqhdqnptqovovia
Get-Content .\supabase\.temp\project-ref
```

The final command prints only the linked project ref, not keys or secrets.

If `supabase login` opens a browser or asks for an access token, complete that locally. Do not paste access tokens into chat or commit them.

## Phase 3: Dev Schema And Migration Selection

Do not run `supabase db push` from this repo for AI Studio setup without a separate reviewed migration plan. The current migration folder includes cron and billing/Stripe history that is not needed for AI Deal Studio local APK testing, and some cron migrations call hosted Edge Function URLs.

Minimum existing schema areas needed for local APK owner testing:

- `auth.users` is provided by Supabase Auth.
- `profiles`, including the settled hard role split.
- `businesses` and owner RLS.
- `business_profiles`.
- `business_locations`, because the owner flow and pilot location cap use it.
- `business_menu_items`, because the deal creation flow can depend on menu/item data.
- `deal_templates`, `deals`, `deal_claims`, and related guardrail/RPC fixes used by existing offer/deal code.
- `business-logos` storage only if testing business setup/logo upload.
- `deal-photos` storage only if testing the existing deal photo flow.
- `ai_generation_logs`, AI quota RPCs, AI cost ledger, and provider circuit breaker tables if testing AI generation/cost tracking.
- Offer version tables/RPCs if testing draft-to-offer behavior through the existing offer version foundation.

Explicitly skip for this dev feature unless there is a separate approval:

- Any migration that schedules production-hosted cron calls.
- Stripe, billing, subscriptions, trials, billing entitlements, or paid-surface migrations unless a later task requires a non-production billing sandbox.
- Any migration that deploys or configures production secrets.

Recommended safe approach if schema work is ever needed:

1. Verify the CLI is linked to the intended active project.
2. Create a reviewed task-specific SQL bundle outside `supabase/migrations`.
3. Include only the required schema/policy pieces listed above.
4. Exclude production cron URL migrations and billing/Stripe-only migrations.
5. Apply the reviewed SQL bundle only after explicit approval.

Do not run `supabase db push` from this repo until a later task explicitly creates a safe migration command plan or removes the production-targeted migrations from the operation. If any RLS migration is applied, run:

```powershell
node .\scripts\probe-rls-smoke.mjs
```

## Phase 4: Storage Buckets And RLS

Required for AI Deal Studio generated assets:

- Bucket: `ai-deal-assets`
- Public: `false`
- Access: owner-scoped by business folder prefix
- Serving: signed URL flow only

Optional existing buckets:

- `business-logos`, needed only for owner setup/logo testing.
- `deal-photos`, needed only for existing deal photo testing.

Use [ai_deal_studio_dev_storage.sql](./ai_deal_studio_dev_storage.sql) as the dev-only SQL checklist for the private AI asset bucket. It is intentionally stored under `docs/dev`, not `supabase/migrations`.

Suggested object path convention:

```text
<business_id>/<draft_id>/<asset_file_name>
```

The policy snippet allows a signed-in business owner to manage only objects whose first path segment is a business they own.

## Phase 5: Edge Functions, Dev Only

Likely existing functions needed for AI Deal Studio local APK testing:

- `ai-generate-deal-copy`, if Studio drafts generate or refine offer copy.
- `ai-generate-ad-variants`, if Studio uses existing image/ad variant pipelines.
- `ingest-analytics-event`, only if local Studio events are logged.

Potential new later functions should be deployed only after explicit approval.

Set secrets in the Supabase dashboard or CLI. Do not paste them into chat:

```powershell
supabase secrets set OPENAI_API_KEY
supabase secrets set SUPABASE_SERVICE_ROLE_KEY
```

Optional non-secret model/provider flags can be set later as needed. Do not configure Stripe for this dev feature.

Deploy only after verifying the linked ref:

```powershell
Get-Content .\supabase\.temp\project-ref
supabase functions deploy ai-generate-deal-copy --project-ref kvodhiqhdqnptqovovia
```

## Phase 6: Dev APK Validation

Run the no-secret config validation:

```powershell
$env:EXPO_PUBLIC_SUPABASE_URL="https://kvodhiqhdqnptqovovia.supabase.co"
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY="placeholder-anon-key"
$env:TWOFER_APP_VARIANT="ai-studio-dev"
$env:EXPO_PUBLIC_APP_VARIANT="ai-studio-dev"
$env:EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV="true"
$env:EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING="true"
node .\scripts\validate-ai-studio-dev-config.mjs
```

Expected checks:

- Dev config app name is `Twofer Dev`.
- Dev Android package is `com.unvmex2.twoforone.dev`.
- Dev config may use the production Supabase host only because publishing is disabled.
- Production config app name remains `Twofer`.
- Production Android package remains `com.unvmex2.twoforone`.
- Production `versionCode` remains the current `app.json` value.
- AI Studio publishing is disabled.

Build/install instructions remain in [AI_DEAL_STUDIO_DEV_APK_SETUP.md](./AI_DEAL_STUDIO_DEV_APK_SETUP.md).
