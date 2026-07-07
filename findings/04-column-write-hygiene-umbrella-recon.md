# Finding 04 recon: per-table audit results

Read-only audit against the migrations (no prod access — see
`findings/00-recon-notes.md` for the same caveat). Scope was
`deals`, `business_locations`, `business_profiles`, `favorites` per the plan's
Phase 3 priority list.

## `business_locations` — CLEAN, no action needed

Base columns (`20260530120000_business_locations_deal_location.sql`): `id,
business_id, name, address, phone, lat, lng, created_at`. No later migration
adds a billing/entitlement/trust column to this table — the actual
billing/suspension mirror lives entirely on the separate `location_entitlements`
table, which is already `REVOKE ALL FROM anon, authenticated` (confirmed sound
in `AUDIT_ROADMAP.md`'s "verified SOUND" list). Every column a client can write
here (name/address/phone/lat/lng) is a legitimate owner-editable profile field.
No fix needed.

## `business_profiles` — CLEAN, confirms finding's own claim

Base columns (`20260601000000_create_business_profiles.sql`): `id, user_id,
owner_id, name, address, category, setup_completed, created_at, updated_at`.
The billing columns added later (`stripe_customer_id, stripe_subscription_id,
subscription_status, subscription_tier, trial_ends_at, current_period_ends_at`)
are already column-level `REVOKE UPDATE ... FROM anon, authenticated`
(`20260726120000_location_billing_entitlements.sql:697`, correctly revoked from
`anon, authenticated` directly, not just `PUBLIC` — matches the lesson from the
prior REVOKE-insufficient incident). No other access-bearing column remains.

Residual, non-blocking observation: the UPDATE policy is `USING (auth.uid() =
user_id OR auth.uid() = owner_id) WITH CHECK (same)`, so a client that owns a
row via `user_id` could in principle PATCH `owner_id` to an arbitrary other
user's id (WITH CHECK still passes because `user_id` still matches). I traced
every place `business_profiles.owner_id`/`user_id` feeds a privilege decision
(`can_business_publish`'s fallback join) and could not construct an actual
exploit — the join is keyed off the *current* business's own owner id, not the
forged value, so this doesn't grant access to someone else's entitlement. The
client's only real write (`app/business-setup.tsx:533-553`) always sets
`user_id`/`owner_id` to the caller's own `uid`, so freezing them to `OLD` on
UPDATE would cost nothing — but I did not add a trigger for it since I could
not confirm a real exploit path and didn't want to add unrequested surface
area. Flagging for a future pass if Dan wants defense-in-depth here.

## `favorites` — CLEAN, no action needed

Columns: `id, user_id, business_id, created_at`. No UPDATE policy exists at all
(only SELECT/INSERT/DELETE), so the default table-level UPDATE grant is inert
regardless (RLS default-denies without a matching policy). Nothing
server-owned lives on this table. No fix needed.

## `deals` — NOT a "forgotten revoke" like 01/02. Needs a product decision, not a quick trigger.

This is the one real finding, and it's more nuanced than Findings 01/02: the
columns Finding 04 worried about (`deal_status`, `eligibility_status`,
`eligibility_reason_code`, `eligibility_message`, `customer_value_percent`,
`deal_type`, `applies_to`, `discount_percent`, and the item quantity/value
columns) are not merely *forgotten* server-owned columns — **the legacy AI
create/publish flow in `app/create/ai.tsx` writes them directly from the
client today**, as part of its normal, currently-shipping publish path:

```
lib/deal-eligibility-form.ts:18  export const DEAL_ELIGIBILITY_DEAL_COLUMN_KEYS = [
  "deal_status", "eligibility_status", "eligibility_reason_code",
  "eligibility_message", "customer_value_percent", "deal_type", "applies_to",
  "discount_percent", "required_purchase_quantity", "free_item_quantity",
  "required_item_description", "required_item_retail_value_cents",
  "free_item_description", "free_item_retail_value_cents",
  "free_item_discount_percent", "item_description", "item_retail_value_cents",
] as const;

app/create/ai.tsx:3305  async function updateDealWithCompatibility(row) {
  ...
  const result = await supabase.from("deals").update(payload)...
```

`row` is built from a **client-side** eligibility computation (presumably
mirroring whatever server-side validator these columns are meant to certify —
I did not find a SQL-side equivalent of a full eligibility validator; only
`is_strong_deal_offer`, which checks title/description text strength, exists in
SQL). So simply revoking these columns or freezing them with an OLD-vs-NEW
trigger (the Finding 01/02 pattern) **would break the shipping publish flow**
— exactly the "Do NOT blanket-REVOKE a table the client does write directly"
warning in Finding 04 itself.

**What IS already protected, independent of these columns:**
- `quality_tier` and the strong-deal-guard (`is_strong_deal_offer`) are
  server-recomputed by a trigger on `BEFORE INSERT OR UPDATE OF title,
  description` (`20260707130000_align_strong_deal_guard_with_client.sql`,
  `20260402130000_server_set_quality_tier.sql`) — this cannot be bypassed by
  forging `eligibility_status`/`customer_value_percent`, because it runs off
  the actual title/description text regardless of what other columns say.
- `deals_block_suspended_location_write` blocks any deal write (including
  reactivation) for a billing-suspended location.
- Customer-facing visibility (RLS `"Anyone can read active deals"`) is gated
  purely by `is_active = true AND end_time > NOW()` — **not** by
  `deal_status`/`eligibility_status` at all. `is_active` is already, and
  legitimately, directly client-writable both ways
  (`app/(tabs)/dashboard.tsx:914,977` sets `is_active: true` to resume a
  paused deal) — this predates this audit and isn't something Findings 01-03
  asked to change.

**What is NOT protected:** a business could theoretically PATCH
`eligibility_status='VALID', customer_value_percent=100` etc. on a deal without
those values reflecting a real eligibility computation, as long as the
title/description text still independently satisfies the regex-based
strong-deal-guard (which is a known, accepted limitation of that guardrail —
gameable by keyword-stuffing regardless of this finding). The blast radius is
bounded to "the structured eligibility metadata can be untrustworthy," not "an
otherwise-blocked weak deal becomes publicly claimable" — the two things that
actually gate customer-facing publish (`is_active` + the strong-deal-guard) are
not affected by forging these columns.

**Why I stopped here instead of fixing it:** the correct fix is almost
certainly to move this write into a service-role edge function/RPC that
independently recomputes eligibility server-side — mirroring the pattern the
newer `offer_versions_foundation` / `publish_offer_version` RPC
(`20260724120000_offer_version_publish_rpc.sql`) already uses. But that means
changing **AI create review/publish behavior** in `app/create/ai.tsx`, which
`CLAUDE.md`'s AI/offer rules explicitly hard-gate: *"Before changing AI poster
layout, AI ad prompts, AI ad image generation, offer-to-poster copy, AI create
review/publish behavior... stop and get Dan's explicit approval for each file
individually."* I also don't know whether `app/create/ai.tsx`'s legacy
direct-deals-table path is still the primary production publish path or is
being superseded by the offer-versions RPC flow — that's a product fact only
Dan has, and it changes which fix is even correct (patch the legacy path vs.
let it be replaced).

**Recommendation (pending Dan's decision):** do not touch `app/create/ai.tsx`
or these columns' grants without his explicit go-ahead on which of the two
paths (legacy `deals` direct-write vs. `offer_versions` RPC) is authoritative
going forward.
