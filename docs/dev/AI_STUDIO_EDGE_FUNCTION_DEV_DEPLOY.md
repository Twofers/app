# AI Studio Dev Edge Function

Function:

```text
ai-studio-generate-draft
```

Deploy only to the development project:

```powershell
Get-Content .\supabase\.temp\project-ref
supabase functions deploy ai-studio-generate-draft --project-ref dyzqgzrslrirzqzhhqxh
```

The function is draft-only. It writes `ad_generation_jobs`, `ad_creatives`, `ai_generation_logs`, and `ai_generation_costs`, but it does not create feed deals and does not publish offers.

## Secrets

Do not put server keys in Expo env files.

Text generation uses the same shared provider pattern as the regular app:

- `OPENAI_API_KEY` for the OpenAI text provider.
- `OPENAI_MODEL` for the GPT text model. The regular app default is `gpt-5.4-mini`; AI Studio dev should use that GPT mini model.
- Optional router controls such as `AI_V3_PROVIDER_ROUTER_ENABLED`, `AI_TEXT_PRIMARY_PROVIDER`, and `AI_TEXT_FALLBACK_ENABLED` stay server-side only. For this dev phase, keep the text primary provider as OpenAI/GPT mini.

Set server-side only:

```powershell
supabase secrets set OPENAI_API_KEY --project-ref dyzqgzrslrirzqzhhqxh
supabase secrets set OPENAI_MODEL=gpt-5.4-mini --project-ref dyzqgzrslrirzqzhhqxh
```

This command prompts locally; do not paste the key into chat or commit it to a file.

Real copy/prompt generation is dev-only and still does not generate images.

Image generation will use the regular app's Gemini image-provider variables later, but it remains disabled in this phase:

- `GEMINI_API_KEY` for Gemini image generation, server-side only.
- `AI_IMAGE_PROVIDER=gemini`
- `AI_IMAGE_GEMINI_ENABLED=true`
- `GEMINI_IMAGE_MODEL=gemini-3.1-flash-image`
- `AI_STUDIO_ENABLE_IMAGE_GENERATION=false`

Do not set `AI_STUDIO_ENABLE_IMAGE_GENERATION=true` until image generation is separately approved.

Keep image generation disabled:

For no-cost validation, leave `OPENAI_API_KEY` unset or set:

```powershell
supabase secrets set AI_STUDIO_DRY_RUN=true --project-ref dyzqgzrslrirzqzhhqxh
```

To allow real copy/prompt generation after setting `OPENAI_API_KEY`, make sure the forced dry-run secret is unset or false:

```powershell
supabase secrets unset AI_STUDIO_DRY_RUN --project-ref dyzqgzrslrirzqzhhqxh
```

Image generation is disabled unless this server-side flag is explicitly enabled later:

```powershell
supabase secrets set AI_IMAGE_PROVIDER=gemini --project-ref dyzqgzrslrirzqzhhqxh
supabase secrets set AI_IMAGE_GEMINI_ENABLED=true --project-ref dyzqgzrslrirzqzhhqxh
supabase secrets set GEMINI_IMAGE_MODEL=gemini-3.1-flash-image --project-ref dyzqgzrslrirzqzhhqxh
supabase secrets set AI_STUDIO_ENABLE_IMAGE_GENERATION=false --project-ref dyzqgzrslrirzqzhhqxh
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

After `OPENAI_API_KEY` is configured in the dev Supabase project, real copy/prompt smoke can be enabled for the current PowerShell process:

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
