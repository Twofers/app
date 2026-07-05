# Website Demand Proof And Sales CRM

Date: 2026-08-02

## Scope

Adds admin-only demand proof and field-sales workflows for local cold-start operations in Irving, Coppell, Carrollton, Las Colinas, and Valley Ranch.

## Backend

- Tables: `business_demand_signals`, `business_demand_rollups`, `sales_accounts`, `sales_activities`
- Public-safe demand endpoint: `request-business-on-twofer`
- Admin demand report: `admin-demand-proof`
- Admin sales script: `admin-sales-script`
- Admin sales updates: `admin-prospect-sales`
- Trial conversion: `admin-trial-create-from-prospect`

## Privacy Rules

Demand capture requires an authenticated user and dedupes by target, signal type, user, and day. Public projections show aggregate demand only above the 5 unique-user threshold. Demand proof never includes names, emails, phone numbers, household-level location, or individual behavior.

Sales scripts use merchant-safe language and do not say an unclaimed business is already a partner.
