# Google/Gemini AI Data Flow

Date: 2026-06-22

Scope: this documents Google/Gemini usage in the AI ad generation workstream. It is an internal repo handoff and activation gate for Dan. It is not a production deployment record, and it does not replace the public website privacy policy or subprocessor update.

## Activation Status

Google/Gemini text fallback must stay disabled in production until the public privacy/subprocessor update is approved and deployed by Dan in the website repo.

Required hosted flags for text fallback:

- `AI_V3_PROVIDER_ROUTER_ENABLED=true`
- `AI_TEXT_FALLBACK_ENABLED=true`
- `AI_TEXT_FALLBACK_PROVIDER=gemini`
- `GEMINI_TEXT_MODEL=gemini-3.5-flash` or another allowlisted text model

The current code keeps text fallback closed by default:

- `AI_V3_PROVIDER_ROUTER_ENABLED` defaults to false.
- `AI_TEXT_FALLBACK_ENABLED` defaults to false.
- `fallbackEnabled` is true only when the router is enabled and `AI_TEXT_FALLBACK_ENABLED` is true.

Until the public privacy/subprocessor update is deployed, keep `AI_TEXT_FALLBACK_ENABLED=false`.

## Google/Gemini Touchpoints

Text fallback:

- Code: `supabase/functions/_shared/ai-text-provider.ts`
- Caller: `supabase/functions/ai-generate-ad-variants/index.ts`
- Purpose: structured ad-copy candidates, copy revision, and repair fallback when OpenAI is unavailable and fallback flags are enabled.
- Data sent: system prompt rules, structured offer facts, merchant creative profile facts derived from existing business context, category playbook context, schedule/quantity/eligibility summaries, requested language, and JSON schema.

Independent candidate judge:

- Code: `supabase/functions/ai-generate-ad-variants/index.ts`
- Flag: `AI_V3_INDEPENDENT_JUDGE_ENABLED`
- Model secret: `GEMINI_JUDGE_MODEL`
- Purpose: optional blind judging of OpenAI-generated candidates.
- Data sent: structured offer facts, category playbook, merchant profile facts, creative brief, and the strongest valid candidates.

Image generation and image edit:

- Code: `supabase/functions/_shared/ai-image-provider.ts`
- Caller: `supabase/functions/ai-generate-ad-variants/index.ts`
- Flags and secrets: `AI_IMAGE_GEMINI_ENABLED`, `AI_IMAGE_PROVIDER`, `GEMINI_IMAGE_MODEL`, `AI_IMAGE_OWNER_PHOTO_REFERENCE_ENABLED`
- Purpose: generated ad imagery or merchant-photo AI edit when image routing selects Gemini.
- Data sent for generated imagery: image prompt with business/category context, structured offer facts, required product/item labels, style preset, and no-readable-text instructions.
- Data sent for merchant-photo edit: the same image prompt plus the owner-uploaded source image bytes as a reference image when owner photo references are enabled.

## Data Not Sent To Google/Gemini

Customer personal data is not sent to Google/Gemini in the AI ad generation path.

Do not send these values in prompts, docs, logs, or support transcripts:

- QR tokens, claim codes, and redemption codes are not sent.
- Push tokens are not sent.
- Supabase keys, auth tokens, provider API keys, APNs keys, signing material, and service-role secrets are not sent.
- Full customer email addresses, passwords, birth dates, or ZIP codes are not sent.
- Voice audio is processed ephemerally by the compose-offer path and is not stored; Google/Gemini text fallback receives text prompt content only.

Merchant data that can be sent when a Google/Gemini path is enabled:

- Business name, broad category, and non-sensitive merchant profile facts used for ad relevance.
- Offer facts such as required item, reward item, discount, quantity limit, cutoff, schedule summary, and location summary.
- Owner-uploaded deal photo bytes only for Gemini image edit/reference flows.

## Internal Storage And Logs

Supabase remains the app data store.

Internal logging tables can contain provider metadata:

- `ai_generation_logs`: prompt version, model/provider metadata, request type, success/failure, token counts where available, response payload telemetry, and generated copy metadata.
- `ai_generation_costs`: provider, model, endpoint, token/usage details where available, estimated cost, latency, request grouping, and success/error metadata.

The runtime should log hashes, provider attempts, model names, failure classes, and cost metadata. It must not log raw provider keys, QR tokens, claim codes, redemption codes, or hidden secrets.

## Public Privacy/Subprocessor Copy For Dan

Before enabling Google/Gemini text fallback in production, update the public privacy/subprocessor surface to disclose:

```text
Twofer may use Google Gemini services to help generate, edit, or evaluate merchant-created promotional content, including offer copy and promotional images. Twofer sends merchant-provided business and offer details, and when selected by the merchant, uploaded promotional images, to this provider for that purpose. Twofer does not send customer QR tokens, claim codes, redemption codes, passwords, payment data, or voice audio recordings to Google Gemini for this feature.
```

Dan must approve and deploy that public website change before hosted production can set `AI_TEXT_FALLBACK_ENABLED=true`.

## Activation Checklist

Before enabling Google/Gemini text fallback:

- Public privacy/subprocessor update approved and deployed by Dan.
- `GEMINI_API_KEY` configured only as a hosted Edge secret.
- `GEMINI_TEXT_MODEL` and `GEMINI_JUDGE_MODEL` use allowlisted text models.
- `AI_TEXT_FALLBACK_ENABLED=true` is set only after the public update.
- `npm run gate:ai-ad` passes.
- Baseline measurement runner is available and recent results are reviewed.
- No GPT-5.4-mini versus GPT-5.5 comparison is performed as part of this activation.

