# Operations monitoring and alerting runbook

Audit F-016 (Batch 13 of `docs/full-system-audit/20_prioritized_remediation_plan.md`).
First written 2026-07-12. Owner: Dan (single-operator project — every "owner" below is Dan
until the team grows).

## What exists today (first-party signals)

All first-party telemetry funnels into Supabase tables. There is **no external
monitoring provider, no alerting, and no paging** — critical regressions are
currently customer-reported. This runbook defines what to watch and how,
using only what is already deployed.

| Signal surface | Where | What it carries |
|---|---|---|
| App events + errors | `app_analytics_events` (via `ingest-analytics-event`) | ~30 allow-listed events incl. `app_error` (name + non-reversible hash only), claims/redeems/signups. Context is key-redacted and size-capped (`lib/supabase.ts` `sanitizeContext`, mirrored server-side). |
| AI spend | `ai_generation_costs` (+ `ai_generation_cost_daily` rollup) | Per-call provider, model, ok/error, cost. Surfaced in the admin AI Operating Report. |
| Billing lifecycle | `billing_events`, `billing_provider_events`, `stripe_checkout_sessions` | Checkout/webhook/reconciliation outcomes; `processing_status='failed'` rows are retryable. |
| Admin actions | `admin_audit_log` | Append-only; includes denied/failed admin attempts. |
| Function logs | Supabase dashboard → Edge Functions → Logs | `console.error` lines from every function (message-only convention — never raw error objects; enforced in `ingest-analytics-event` since 2026-07-12). |
| Stripe | Stripe dashboard → Developers → Events/Webhooks | Webhook delivery failures, disputes. |

## Redaction policy (what may never appear in any signal)

- No secrets, auth/push/QR tokens, claim or redemption codes, API keys.
- No raw provider (OpenAI/Gemini/Stripe) response bodies.
- Client/server `sanitizeContext` drops keys matching the sensitive-key regex,
  strings > 120 chars, strings containing `@`, and caps at 20 keys.
- **Known limitation:** redaction is key-based; a sensitive value under an
  innocuous key is not caught. Keep context values to enum-ish short strings.
- Errors are stored as `error_name` + hash only — never message or stack.

## Daily watch (5 minutes, admin command center)

The `/admin` dashboard already aggregates the queues that matter. Zero is the
healthy state for each of these; investigate any sustained non-zero:

1. **Failed billing events** (`billing.failedEvents`) → billing events table,
   retry after diagnosing; a stuck failed webhook can strand a paying owner.
2. **Failed admin actions** (`security.failedActions`) → audit log; repeated
   denials for one account may be probing.
3. **Claims vs redemptions today** — a claims-without-redemptions cliff means
   redemption is broken (QR/staff paths); redemption is the North Star.
4. **API spend this month** — a step-change day-over-day means an AI cost
   regression or abuse; drill into the AI Operating Report / quotas panel.
5. **`app_error` volume** (query below) — new error-hash clusters after a
   release are the earliest crash signal available without a crash SDK.

```sql
-- app_error clusters, last 24h (run in Supabase SQL editor, read-only)
select context->>'error_name' as error_name, context->>'error_hash' as error_hash,
       count(*) as hits, max(created_at) as last_seen
from app_analytics_events
where event_name = 'app_error' and created_at > now() - interval '24 hours'
group by 1, 2 order by hits desc limit 20;
```

## Release watch (first 48h after any deploy/build rollout)

- Function logs for the touched functions filtered to `error`.
- `billing_provider_events` where `processing_status = 'failed'`.
- `app_error` clusters (query above) compared against the pre-release baseline.
- Stripe webhook delivery success rate (Stripe dashboard).

## Incident basics

- **Fail-closed beats fail-open.** Billing and claims already fail closed;
  never "fix" an outage by disabling auth, RLS, or webhook signature checks.
- Rollback = forward deploy of the last-good function/client, never editing
  applied migrations (repo rule).
- Kill switches that exist today: `app_runtime_config.purchase_surface`
  (checkout), per-function redeploy, deal deactivation (owner or admin).
- Record every production action taken during an incident in a dated note
  under `docs/` (there is no ticketing system).

## Retention

- `app_analytics_events` and cost/billing/audit tables currently retain
  indefinitely. Context is redacted, so risk is low, but define a retention
  window (suggestion: raw analytics events 12 months, cost/billing/audit
  retained per financial/legal need) — **Dan decision, not yet made**.

## Gaps / Dan-gated follow-ups (not covered by this runbook)

- No push/email **alerting**: nothing notifies anyone when a queue goes
  non-zero. Options: a scheduled edge function emailing `support@twoferapp.com`
  on thresholds (needs approval + deploy), or an external uptime/alert
  provider (needs provider decision + data-sharing review).
- No crash SDK (Sentry etc.): `app_error` hashes are the only crash signal.
  Adding one is a privacy/provider decision.
- No uptime probe for the website or edge functions.
- Synthetic failure drills (auth, claims, billing, AI, push) have never been
  run; they require test accounts and explicit approval.
