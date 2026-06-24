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

Optional later, set server-side only:

```powershell
supabase secrets set OPENAI_API_KEY --project-ref dyzqgzrslrirzqzhhqxh
```

This command prompts locally; do not paste the key into chat or commit it to a file.

Real copy/prompt generation is dev-only and still does not generate images. Keep image generation disabled:

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
