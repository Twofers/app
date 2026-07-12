# AI Studio Dev Edge Function

Function:

```text
ai-studio-generate-draft
```

Deploy to the active Supabase project after explicit approval:

```powershell
Get-Content .\supabase\.temp\project-ref
supabase functions deploy ai-studio-generate-draft --project-ref kvodhiqhdqnptqovovia
```

The function is draft-only. It writes `ad_generation_jobs`, `ad_creatives`, `ai_generation_logs`, and `ai_generation_costs`, but it does not create feed deals and does not publish offers.

## Secrets

Do not put server keys in Expo env files.

Text generation uses the same shared provider pattern as the regular app:

- `OPENAI_API_KEY` for the OpenAI text provider.
- `OPENAI_MODEL` for the GPT text model. The regular app default is `gpt-5.5`; AI Studio dev can explicitly use the GPT mini rollback model to conserve test cost.
- Optional router controls such as `AI_V3_PROVIDER_ROUTER_ENABLED`, `AI_TEXT_PRIMARY_PROVIDER`, and `AI_TEXT_FALLBACK_ENABLED` stay server-side only. For this dev phase, keep the text primary provider as OpenAI/GPT mini.

Set server-side only:

```powershell
supabase secrets set OPENAI_API_KEY --project-ref kvodhiqhdqnptqovovia
supabase secrets set OPENAI_MODEL=gpt-5.4-mini --project-ref kvodhiqhdqnptqovovia
supabase secrets set AI_TEXT_PRIMARY_TIMEOUT_MS=20000 --project-ref kvodhiqhdqnptqovovia
```

This command prompts locally; do not paste the key into chat or commit it to a file.

Real copy/prompt generation is allowed only through the disabled-publishing AI Studio dev path. Gemini image generation is separately gated and still does not publish.

Image generation uses the regular app's Gemini image-provider variables:

- `GEMINI_API_KEY` for Gemini image generation, server-side only.
- `AI_IMAGE_PROVIDER=gemini`
- `AI_IMAGE_GEMINI_ENABLED=true`
- `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image`
- `AI_STUDIO_ENABLE_IMAGE_GENERATION=true` only when Gemini image testing is approved.

The generated AI Studio source image is stored only in the private `ai-deal-assets` bucket. The function returns `source_asset_path` plus a short-lived signed preview URL for the dev draft. `rendered_asset_path` stays `null` until a later export phase. It does not create a `deals` row and does not call publishing.

The finished dev ad preview is rendered deterministically in the dev app from native overlay text. The Gemini image stays text-free; the app overlays the business wordmark/logo, poster headline, offer lines, and compact time window. The poster must not include the word Twofer, a claim CTA, or an availability badge; exact deal details render below the poster instead. Rendered ad export/storage is intentionally not part of this phase.

Configure Gemini image generation only after image testing is approved:

For no-cost validation, leave `OPENAI_API_KEY` unset or set:

```powershell
supabase secrets set AI_STUDIO_DRY_RUN=true --project-ref kvodhiqhdqnptqovovia
```

To allow real copy/prompt generation after setting `OPENAI_API_KEY`, make sure the forced dry-run secret is unset or false:

```powershell
supabase secrets unset AI_STUDIO_DRY_RUN --project-ref kvodhiqhdqnptqovovia
```

Image generation is disabled unless this server-side flag is explicitly enabled later:

```powershell
supabase secrets set AI_IMAGE_PROVIDER=gemini --project-ref kvodhiqhdqnptqovovia
supabase secrets set AI_IMAGE_GEMINI_ENABLED=true --project-ref kvodhiqhdqnptqovovia
supabase secrets set GEMINI_IMAGE_MODEL=gemini-3.1-flash-image --project-ref kvodhiqhdqnptqovovia
supabase secrets set GEMINI_API_KEY --project-ref kvodhiqhdqnptqovovia
supabase secrets set AI_STUDIO_ENABLE_IMAGE_GENERATION=true --project-ref kvodhiqhdqnptqovovia
```

Do not configure Stripe for this feature.

## Smoke Test

The smoke script reads local-only values:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
TWOFER_SMOKE_EMAIL
TWOFER_SMOKE_PASSWORD
TWOFER_SMOKE_BUSINESS_ID
```

Run:

```powershell
node .\scripts\smoke-ai-studio-generate-draft.mjs
```

If smoke credentials are missing, the script still verifies unauthenticated rejection and skips authenticated checks.

After `OPENAI_API_KEY` is configured in Supabase, real copy/prompt smoke can be enabled for the current PowerShell process:

```powershell
$env:TWOFER_SMOKE_REAL_AI="true"
node .\scripts\smoke-ai-studio-generate-draft.mjs
Remove-Item Env:\TWOFER_SMOKE_REAL_AI -ErrorAction SilentlyContinue
```

Expected real-mode behavior:

- `dryRun` is `false`
- `copy_only` remains `true`
- no image asset path or signed URL is returned
- publishing remains disabled
- `deals` stays `0`

After `GEMINI_API_KEY` and `AI_STUDIO_ENABLE_IMAGE_GENERATION=true` are configured in Supabase, Gemini image smoke can be enabled for the current PowerShell process:

```powershell
$env:TWOFER_SMOKE_REAL_AI="true"
$env:TWOFER_SMOKE_GEMINI_IMAGE="true"
node .\scripts\smoke-ai-studio-generate-draft.mjs
Remove-Item Env:\TWOFER_SMOKE_REAL_AI -ErrorAction SilentlyContinue
Remove-Item Env:\TWOFER_SMOKE_GEMINI_IMAGE -ErrorAction SilentlyContinue
```

Expected Gemini image behavior:

- `dryRun` is `false`
- `copy_only` is `false`
- `image_provider` is `gemini`
- Gemini is requested with a 4:5 image ratio to match the native preview
- `source_asset_path` is a private bucket path, not a URL
- `source_asset_signed_url` is returned only for preview
- `rendered_asset_path` remains `null` in this phase
- publishing remains disabled
- `deals` stays `0`
