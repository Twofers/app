# Edge Function Checklist (MVP Pilot)

This checklist tracks the Edge Functions used by the app and highlights launch risk for a controlled 5-10 cafe pilot.

## Priority Functions

| Function | Where called | Expected input | Expected output | Required for launch | Fallback behavior | Production risk |
|---|---|---|---|---|---|---|
| `claim-deal` | `lib/functions.ts`, `lib/demo-preview-seed.ts`, `scripts/pilot-smoke-test.ts` | `deal_id` plus optional telemetry fields | `{ token, expires_at, claim_id?, short_code? }` | Yes | None | Claim limits / RLS correctness is launch-critical; errors must stay user-friendly. |
| `redeem-token` | `lib/functions.ts`, `lib/demo-preview-seed.ts`, `scripts/pilot-smoke-test.ts` | `{ token }` or `{ short_code }` | `{ ok, redeemed_at, claim_id?, deal_title? }` | Yes | None | Merchant redemption failure blocks core value loop. |
| `begin-visual-redeem` | `lib/functions.ts` | `{ claim_id }` | `{ ok, server_now, redeem_started_at, min_complete_at, resumed? }` | Yes | None | Wallet/use flow reliability and timer logic must be correct. |
| `complete-visual-redeem` | `lib/functions.ts` | `{ claim_id }` | `{ ok, redeemed_at, already_redeemed?, deal_id?, deal_title? }` | Yes | None | Final redemption integrity and anti-double-redeem behavior are launch-critical. |
| `cancel-visual-redeem` | `lib/functions.ts` | `{ claim_id }` | `{ ok }` (legacy path can return 400) | No (legacy) | No client fallback | Legacy endpoint still invoked by client helper; verify behavior does not confuse users. |
| `finalize-stale-redeems` | `lib/functions.ts` | app/device metadata | (best-effort; ignored by client) | Yes (for stale-state recovery) | Fire-and-forget; client suppresses failure | Silent failures can leave claims in `redeeming` too long. |
| `delete-user-account` | `lib/functions.ts` | `{}` | success or blocked code `BUSINESS_OWNER_DELETE_BLOCKED` | Yes | None | Incorrect policy can delete owner accounts unexpectedly or block consumers. |
| `ingest-analytics-event` | `lib/app-analytics.ts` | event payload (`event_name`, optional ids, context, app/device metadata) | append success (not used by UI) | Yes (ops visibility) | Fire-and-forget; client drops failures | Data loss is silent if endpoint or RLS breaks. |
| `ai-extract-menu` | `lib/functions.ts` via `app/create/menu-scan.tsx` | `business_id` + one of `image_url` or `image_base64` | `{ ok, items[], low_legibility, menu_notes, extraction_source }` | Yes (primary owner flow) | Demo account sample path; optional preview synthetic fallback when explicitly enabled by secret | High: previously returned fake success when `OPENAI_API_KEY` missing; now returns config error in production mode. |
| `ai-compose-offer` | `lib/ai-compose-offer.ts` | prompt/composition payload (typed in file) | composed offer payload used by create flow | Secondary | Internal error handling in caller | AI quality and latency variability; verify non-raw errors. |
| `ai-generate-ad-variants` | `lib/functions.ts` | `business_id`, `hint_text`, `business_context`, locale and optional media/revision fields | `{ ad, ads?, quota? }` (single-ad pipeline; `ads` legacy compat) | Yes for AI-first owner flow | None in wrapper (throws) | If unavailable, owner ad generation blocks primary path. |
| `ai-generate-deal-copy` | `lib/functions.ts`, `components/welcome-walkthrough.tsx` | `hint_text`, optional `price`, `business_name`, `business_id` | `{ title, promo_line, description }` | Secondary | Demo-only template fallback; non-demo users now receive errors when generation fails | Medium: still AI-dependent; production now avoids fake-success copy when unavailable. |
| `ai-create-deal` | `lib/functions.ts` (legacy path) | business, photo, hint, timing, caps | deal payload with `deal_id`, copy, `poster_url` | No (legacy) | None | Signed URL/legacy one-shot path not ideal for pilot happy-path. |
| `stripe-create-checkout-session` | `app/(tabs)/billing.tsx`, `app/(tabs)/billing/manage.tsx` | plan/tier selection payload | `{ checkout_url }` | Depends on billing gate mode | None | Billing is bypassed for pilot (`PILOT_DISABLE_BILLING_GATE=true`), but endpoint still needs safe behavior for future cutover. |

## Additional Function Call Sites (Non-priority but relevant)

- `billing-pricing` in `app/(tabs)/billing.tsx`
- `stripe-customer-portal-session` in `app/(tabs)/billing/manage.tsx`
- `simulate-subscribe` in `app/(tabs)/billing.tsx` (dev/pilot helper)
- `send-deal-push` in `lib/functions.ts`
- `ai-business-lookup` in `lib/functions.ts`
- `ai-translate-deal` in `lib/functions.ts`
- `ai-deal-suggestions` in `components/ai-insights-card.tsx`

## Production-Risk Notes

- `ai-business-lookup` now throws to callers for non-demo users when lookup fails (`lib/functions.ts`), so UI shows error banners instead of hardcoded Irving data.
- `ai-generate-deal-copy` now throws for non-demo users in `lib/functions.ts`, and the Edge function returns `OPENAI_NOT_CONFIGURED` when `OPENAI_API_KEY` is missing (non-demo path), preventing fake AI copy.
- `app/create/ad-refine.tsx` now exists as a safe placeholder route that directs users to `/create/ai`.
- `simulate-subscribe` should remain restricted to non-production operations.
