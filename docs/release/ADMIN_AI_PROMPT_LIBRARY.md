# Admin AI Prompt Library

Date: 2026-08-02

## Registry

Prompt defaults remain hardcoded server-side in `supabase/functions/_shared/admin-ai.ts`, but active prompt versions are now stored in the admin-only `admin_ai_prompts` registry and edited through `/admin/ai-prompts`.

The shared admin AI helper loads the active registry row for each feature before calling the provider. If the registry is unavailable, it falls back to the hardcoded version. Every output logs the actual prompt version used.

| Feature | Prompt version |
| --- | --- |
| Prospect enrichment | `admin-prospect-enrichment-v1` |
| Prospect scoring | `admin-prospect-score-v1` |
| Demand proof | `admin-demand-proof-v1` |
| Sales script | `admin-sales-script-v1` |
| Onboarding review | `admin-onboarding-review-v1` |
| Claim-link assistant | `admin-claim-link-assistant-v1` |
| Trial conversion assistant | `admin-trial-conversion-assistant-v1` |
| Operating report | `admin-operating-report-v1` |

## Admin UI

- Route: `/admin/ai-prompts`
- Edge Function: `admin-ai-prompts`
- Permission: `prompt.manage` for owner/admin/developer roles
- Writes are audited as `admin_ai_prompt_saved`, `admin_ai_prompt_activated`, or `admin_ai_prompt_deactivated`

The browser can edit registry rows only through the authenticated admin Edge Function. No AI provider keys, service-role keys, or prompt execution calls are exposed to browser code.

## Output Contract

Every admin AI output is stored with:

- `confidence`
- `sources`
- `warnings`
- `review_status`
- `generated_at`
- `model`
- `provider`
- `prompt_version`
- `requires_human_review`
- `safe_for_public_display`

## Review Model

AI can recommend, summarize, and draft. It cannot approve applications, create claim tokens, create trials, create Stripe customers, bill businesses, or create live offers. Admin actions remain separate clicks with separate audit records.
