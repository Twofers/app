# Website AI Operating Reports

Date: 2026-08-02

## Scope

Adds an admin operating report for AI/prospect workflows at `/admin/ai-operating-report`.

## Backend

- Edge Function: `admin-ai-operating-report`
- Reads existing AI ledgers:
  - `ai_generation_costs`
  - `ai_generation_cost_by_feature_model`
  - `ai_provider_circuit_breakers`
  - `admin_audit_log`
- Reads new prospect/sales/claim tables from `20260802120000_business_prospect_command_center.sql`

## Report Sections

- AI enrichment volume
- AI cost by feature/model/endpoint
- Provider failures and circuit breaker state
- Score distribution
- Prospects needing review
- Stale source counts
- Demand proof generated
- Sales activity
- Claim links sent, accepted, and expired
- Prospect-to-trial and trial-to-active conversion counts

No AI provider keys, raw upstream responses, private enrichment payloads, claim token hashes, or customer-level demand data are exposed in the report.
