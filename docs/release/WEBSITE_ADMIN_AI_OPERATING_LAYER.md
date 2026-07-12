# Website Admin AI Operating Layer

Date: 2026-08-02

## Scope

This layer runs AI-assisted Twofer operations from the website/admin dashboard only. It extends the existing admin dashboard, Supabase Edge Function architecture, admin allowlist, MFA checks, audit log, AI provider router, AI cost ledger, provider circuit breaker, and prospect command center.

No mobile app screen receives prospect import, enrichment, scoring, CRM, sales scripts, claim-link support, trial conversion, billing, Stripe, provider-cost, or operating-report workflows.

## Edge Functions

- `admin-prospect-enrich`
- `admin-prospect-score`
- `admin-demand-proof`
- `admin-sales-script`
- `admin-onboarding-review-ai`
- `admin-claim-link-assistant`
- `admin-trial-conversion-assistant`
- `admin-ai-operating-report`

All provider-backed calls use `_shared/admin-ai.ts`, which wraps the existing structured text provider router and logs cost attempts plus final output metadata.

## Admin Routes

- `/admin/prospects`
- `/admin/prospects/:prospectId`
- `/admin/sales-ai`
- `/admin/trial-requests`
- `/admin/ai-operating-report`
- `/admin/ai-prompts`

## Database

Migration `20260802130000_admin_ai_operating_layer.sql` extends `ai_generation_logs` for admin/prospect AI output:

- `admin_user_id`
- `related_prospect_id`
- `related_business_id`
- `provider`
- `cost_basis_json`
- `sources_json`
- `review_status`
- `safe_for_public_display`
- `requires_human_review`

It also allows prospect-only AI logs by relaxing `ai_generation_logs.business_id` and updates prospect score tiers to `A`, `B`, `C`, and `Do Not Contact`.

Migration `20260802140000_admin_ai_prompt_registry.sql` adds `admin_ai_prompts`, an RLS-closed admin-only prompt registry. Active prompt rows override hardcoded defaults server-side and update `last_used_at` when used.

## Staging Smoke

Run deployed staging checks with:

```bash
npm run smoke:admin-ai-staging
```

Required environment variables are `TWOFER_STAGING_SUPABASE_URL`, `TWOFER_STAGING_SUPABASE_ANON_KEY`, `TWOFER_STAGING_ADMIN_EMAIL`, and `TWOFER_STAGING_ADMIN_PASSWORD`. The script refuses the known production Supabase URL unless explicitly overridden.

## Deployment Notes

Apply migrations before deploying the new or updated Edge Functions. Do not run `supabase db push`, deploy Edge Functions, or change hosted secrets without explicit approval.

Required existing secrets are the same server-side AI secrets already used by the app functions, such as `OPENAI_API_KEY` and optional Gemini router secrets. No AI key is added to Expo or browser client code.
