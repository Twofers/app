# Storage bucket backup inventory

Statically detected bucket names. Before the first backup job is activated,
compare this list with `storage.buckets` in the linked project; the live list
wins.

Latest linked-project snapshot: **2026-07-29T19:16:28.482Z**.

| Bucket | Evidence | Backup requirement |
|---|---|---|
| `ai-deal-assets` | docs/dev/AI_DEAL_STUDIO_DEV_SCHEMA_BUNDLE.sql, docs/dev/ai_deal_studio_dev_storage.sql, docs/dev/AI_STUDIO_DEV_OWNER_READ_PATCH.sql, linked production Storage API snapshot | daily object backup + manifest + checksum |
| `business-assets` | linked production Storage API snapshot | daily object backup + manifest + checksum |
| `business-logos` | app/business-setup.tsx, docs/dev/AI_DEAL_STUDIO_DEV_SCHEMA_BUNDLE.sql, supabase/migrations/20260704120000_business_logo_storage.sql, supabase/migrations/20260812140000_business_logo_owner_write_policies.sql, supabase/migrations/20260820120000_route_business_ownership_through_definer_helper.sql, linked production Storage API snapshot | daily object backup + manifest + checksum |
| `deal-ads` | linked production Storage API snapshot | daily object backup + manifest + checksum |
| `deal-photos` | app/create/ai.tsx, artifacts/ai-hardening/2026-07-20/harness/cleanup.mjs, artifacts/ai-hardening/2026-07-20/harness/tier1-image.mjs, artifacts/poster-quality/2026-07-20/harness/cleanup-orphan.mjs, artifacts/poster-quality/2026-07-20/harness/validate-image-fixes.mjs, artifacts/poster-quality/2026-07-20-run2/harness/cleanup-copy-gates.mjs | daily object backup + manifest + checksum |
