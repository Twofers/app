# Admin AI Security And Privacy

Date: 2026-08-02

## Boundary

Admin AI runs through Supabase Edge Functions only. Browser code calls internal admin Edge Functions with the admin session token; it never receives AI provider keys or service-role keys. The Expo mobile app does not import the admin AI helper or call these admin functions.

## Privacy

- Demand proof uses aggregate rollups only.
- Counts below the minimum privacy threshold are withheld or converted to broad early-interest language.
- Customer names, emails, phone numbers, exact home locations, and individual behavior are not sent to merchant-facing output.
- Source payloads and private prospect data stay admin/service-role only.

## Claim Links

The AI claim-link assistant drafts copy and recommendations only. Token creation remains in `admin-claim-link-create`, which stores `token_hash` and returns the raw token only once to the admin client. Raw tokens are not written to audit logs or database rows.

## Safety Rules

- AI output does not overwrite verified facts without an explicit admin review action.
- AI enrichment starts with `review_status = needs_review`.
- Unclaimed prospects cannot create `deals` rows.
- Unclaimed businesses must not be described as partners.
- Stripe and billing actions remain website/admin/server-only.
- Provider failures return sanitized errors; raw upstream bodies are not returned to clients.

## Prompt Registry

- Prompt editing lives at `/admin/ai-prompts`.
- Prompt rows are stored in `admin_ai_prompts`, with RLS enabled and direct anon/authenticated grants revoked.
- Browser code can list/save/activate prompts only through `admin-ai-prompts`.
- Prompt writes require `prompt.manage` and are audited.
- Provider keys and service-role keys are never exposed to the prompt UI.

## Validation

Source tests guard the admin-only boundary, Edge Function registration, prompt registry isolation, claim-token handling, no live-deal creation from prospect AI functions, public projection privacy, deployed staging smoke coverage, and mobile code isolation.
