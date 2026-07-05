# Website Prospect Command Center

Date: 2026-08-02

## Scope

Adds the website/admin foundation for local unclaimed business prospects under the existing `/admin` dashboard. This is web/admin/server-only work and does not add CRM, scoring, claim links, billing, or prospect workflows to the mobile app.

## Routes

- `/admin/prospects`
- `/admin/prospects/import`
- `/admin/prospects/[prospectId]`
- `/admin/prospects/[prospectId]/demand`
- `/admin/prospects/[prospectId]/sales`
- `/admin/prospects/[prospectId]/claim-links`
- `/admon` redirects to `/admin`

## Backend

- Migration: `supabase/migrations/20260802120000_business_prospect_command_center.sql`
- Read function extension: `supabase/functions/admin-dashboard-summary/index.ts`
- Admin functions:
  - `admin-prospect-import`
  - `admin-prospect-enrich`
  - `admin-prospect-score`
  - `admin-prospect-sales`

## Safety Notes

Prospects are stored in `business_prospects`, not `businesses`. Prospect import, enrichment, scoring, and sales records do not create `deals` rows. Private contact data, source payloads, enrichments, scores, sales notes, and duplicate metadata are admin/service-role only.

Public label states are limited to `Not on Twofer yet`, `On Twofer`, and `Live offer available`.
