# AI Ad Baseline Metrics

Date: 2026-06-20
Branch: `codex/ai-ad-current-state-audit`
Plan source: `C:\Users\unvme\Downloads\TWOFER_AI_AD_GENERATION_MASTER_PLAN(1).md`

## Status

The baseline metrics pull is now tooled, but live production values could not be truthfully recorded from this workspace because no read-capable secret was available.

This is not a production-zero result. The local `.env` contains only public Expo/Supabase values. A read-only anon REST probe confirmed that the private AI ledgers are not accessible enough for baseline measurement:

- `ai_generation_logs`: HTTP 200 with an empty RLS-filtered result under anon access.
- `ai_generation_costs`: HTTP 401, `permission denied for table ai_generation_costs`.

The cost ledger denial matches the migration intent: `ai_generation_costs` is service-role only. The logs result must not be interpreted as "zero production usage" because `ai_generation_logs` has RLS enabled and no client read policy.

## Runner

Use the read-only runner:

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<set locally; do not paste into chat>"
$env:BASELINE_DAYS = "30"
$env:BASELINE_OUTPUT_JSON = "artifacts/ai-ad-baseline.json"
$env:BASELINE_OUTPUT_MD = "artifacts/ai-ad-baseline.md"
node scripts/measure-ai-ad-baseline.mjs
```

The script does not print secrets. It performs REST `select` reads against:

- `ai_generation_logs`
- `ai_generation_costs`

## Metrics Covered

The runner records:

- ad generation log rows for `ad_variants` and `ad_refine`;
- success and failure rate;
- quota-blocked and duplicate-blocked counts;
- p50 / p95 copy latency from `response_payload.copy.latency_ms`;
- deterministic fallback rate from `response_payload.copy.source`, `deterministic_fallback_used`, and fallback events;
- validation-failure and repair-attempt rates;
- image source counts and image failure rate;
- total AI cost, average cost per request group, and p50 / p95 cost per request group;
- provider call counts by feature, endpoint, and model;
- failed/retried provider call rate.

## Known Instrumentation Gaps

- Total end-to-end generation duration is not persisted as a first-class field. The app currently records copy latency, but not full start-to-preview or all-variants-ready p50/p95.
- `ai_generation_logs` does not store `request_group_id`, so cost rows and generation log rows are aggregated separately.
- Publish conversion and no-edit publish rate cannot be computed reliably until generation/ad ids are written to `deals` or a `publish_events` table.
- End-to-end funnel from generation to exposure to claim to redemption remains weak until `AdSpec` / `OfferVersion` / publish events are durable.

## Phase 0 Acceptance Impact

The repo now has a repeatable baseline measurement path, but the master plan acceptance item "baseline metrics are recorded" remains pending until the script is run with service-role access and the generated output is saved under a local artifact or committed doc.
