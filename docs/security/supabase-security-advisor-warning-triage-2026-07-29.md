# Supabase Security Advisor warning triage — 2026-07-29

The initial production scan after migration `20260824131000` reported zero
errors and 171 warnings. The separately approved migrations `20260824132000`
through `20260824142000` reduced that to zero errors and 43 warnings. This
ledger separates completed zero-cost fixes from warnings that need reachability
analysis or a paid plan. It does not authorize any further production change.

| Rule | Count | Current disposition |
|---|---:|---|
| Authenticated users can execute SECURITY DEFINER function | 34 (was 76) | Thirteen trigger-only, 22 service-role-only, six internal-helper, and one location-ownership-helper finding are closed by separately approved migrations `20260824134000`, `20260824135000`, `20260824141000`, and `20260824142000`. Remaining findings are intentional authenticated RPCs, public-flow helpers, or self-authorizing policy functions. |
| Public can execute SECURITY DEFINER function | 7 (was 66) | Fifty-nine inappropriate anonymous execution findings are closed. The separately approved `20260824140000` migration removed 24 non-public grants while preserving seven functions required by anonymous policies/product flows. |
| Function search path mutable | 0 (was 25) | Closed by separately approved zero-cost migration `20260824133000`. All 25 live definitions and signatures were audited first; the migration only pinned name resolution to `pg_catalog, public`. Production parity, live Advisor results, and representative service-role and anon RPC smoke tests passed. |
| Public bucket allows listing | 0 (was 2) | Closed by separately approved zero-cost migration `20260824132000`. Both buckets remain public, owner write policies remain intact, anon listings expose zero entries, and sampled public assets from both buckets return HTTP 200. |
| Leaked password protection disabled | 1 | Deferred under the $0 bootstrap policy. Supabase documents this as Pro-only; Pro currently starts at $25/month. Revisit after revenue or a broader Pro-plan need justifies the subscription. |
| Extension in public | 1 | `pg_net` is actively used by four scheduled Edge jobs. Do not move it until extension relocation support and every scheduled job are tested in a disposable project. |

## Public bucket listing evidence

The live broad SELECT policies are:

- `Public read business-logos objects`
- `Public read deal-photos objects`

Both buckets have `public = true`. Supabase documents that public asset URLs
need no `storage.objects` RLS permission, while listing is a separate operation
that does require a policy:

- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/reference/python/storage-from-getpublicurl

Repository search found no app/client `.list()` call against either bucket.
The only listing consumers are the independent backup script and
`delete-user-account`; both use trusted service-role access and bypass RLS.

Migration `20260824132000` only drops the two broad SELECT policies. It does not
change bucket visibility, objects, or owner-scoped upload/update/delete
policies. It was separately approved/applied and verified on 2026-07-29. Added
recurring cost is $0. Anon list calls return zero entries for both buckets, and
sampled public logo/poster URLs return HTTP 200 with non-empty files.

## Function search-path evidence

The live definitions and exact signatures for all 25 Advisor findings were
audited before staging migration
`20260824133000_pin_remaining_function_search_paths.sql`. Twenty-two functions
are migration-tracked; `get_best_time_day`, `get_business_dashboard`, and
`rate_limit_hit` are production drift. The migration only sets
`search_path = pg_catalog, public` on the existing functions. It does not
replace bodies, change signatures, ownership, grants, or data.

The static migration gate verifies all 25 exact pins and rejects body
replacement, grant changes, or data mutation. The migration was separately
approved/applied on 2026-07-29 at $0 added recurring cost. Local/production
parity is exact through `20260824133000`; the live Advisor now reports 0 errors,
144 warnings, and zero mutable-search-path findings. Representative pure,
read-only RPCs returned HTTP 200 with the expected results under both
service-role and current anon credentials.

## Trigger-only function execution evidence

The live catalog contains 15 `SECURITY DEFINER` functions bound to triggers.
Thirteen are still directly executable by both `anon` and `authenticated`.
Every one returns `trigger`, has exactly one live non-internal trigger binding,
and has no direct application RPC caller. Trigger execution does not depend on
client-role function grants.

Zero-cost migration
`20260824134000_revoke_trigger_function_client_execute.sql` was separately
approved/applied on 2026-07-29. It only revoked direct `EXECUTE` from `PUBLIC`,
`anon`, and `authenticated` on those 13 functions. Post-apply verification
confirmed all 13 trigger bindings remain enabled, all 13 functions remain
service-role executable, both client roles have zero catalog execution
privileges, and all 13 anon RPC routes return HTTP 404. Parity is exact through
`20260824134000`; Advisor reports 0 errors and 118 warnings. Added recurring
cost is $0.

## Service-role-only function execution evidence

Twenty-two remaining live findings have explicit repository migrations/tests
that grant execution only to `service_role`. Their callers are trusted Edge
Functions, scheduled jobs, or internal database paths; repository search found
no direct mobile/website client caller. The live catalog nevertheless grants
both `anon` and `authenticated` execution on every one.

Zero-cost migration
`20260824135000_revoke_service_role_function_client_execute.sql` was separately
approved/applied on 2026-07-29. Parity is exact through `20260824135000`.
Catalog checks show zero `anon`/`authenticated` execution and retained
service-role execution for all 22 functions. All 22 anon routes are denied
(HTTP 401 or 404), while 11 representative read-only trusted RPCs return HTTP
200. Advisor reports 0 errors and 74 warnings. Added recurring cost is $0.

## Non-public anonymous execution evidence

The remaining 31 anonymous findings were checked against live ACLs, live policy
roles, repository grant contracts, application callers, and function purpose.
Twenty-four functions are not required by anonymous users. Seven remain
intentionally anonymous because they support public deal content/share/search,
public-business visibility, or the current public businesses policy.

Zero-cost migration
`20260824140000_revoke_nonpublic_function_anon_execute.sql` was separately
approved/applied on 2026-07-29. Parity is exact through `20260824140000`.
Catalog checks show zero anonymous execution and retained
authenticated/service-role execution for all 24 functions. All 24 removed anon
routes return HTTP 401; all seven intentional public RPCs and 15 representative
trusted read-only RPCs return HTTP 200. Advisor reports 0 errors and 50
warnings. Added recurring cost is $0.

## Internal helper authenticated execution evidence

Six remaining authenticated findings have no authenticated policy dependency
or mobile/website caller. Live dependencies are limited to the
`cleanup_stale_push_tokens_weekly` cron job, trusted service-role use from
`ai-generate-ad-variants`, and internal SECURITY DEFINER trigger functions.
All six retain service-role execution in the live catalog.

Zero-cost migration
`20260824141000_revoke_internal_helper_client_execute.sql` was separately
approved/applied on 2026-07-29. Parity is exact through `20260824141000`.
Catalog checks show zero client execution and retained service-role execution
for all six helpers. The cleanup cron job remains active, all four dependent
triggers remain enabled, all six anon routes are denied, and four
representative trusted read-only RPCs return HTTP 200. Advisor reports 0
errors and 44 warnings. Added recurring cost is $0.

## Location ownership helper execution evidence

`user_owns_business_location(uuid, uuid)` accepts an explicit user ID, so a
direct authenticated call could reveal whether a user owns a location. Live
policy inspection found no RLS dependency; repository search found no
mobile/website caller. Its only callers are four authenticated Edge billing
flows that use a separate service-role client and the nested
`get_location_billing_summary` helper. The live catalog confirms service-role
execution.

Zero-cost migration
`20260824142000_revoke_location_ownership_helper_client_execute.sql` was
separately approved/applied on 2026-07-29. Parity is exact through
`20260824142000`. Catalog checks show zero client execution and retained
service-role execution. Its anon RPC route returns HTTP 401, its service-role
RPC returns HTTP 200, and Advisor reports 0 errors and 43 warnings. Added
recurring cost is $0.

## Paid warning disposition

Supabase currently documents leaked-password protection as available on Pro
and above:

- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/pricing

The approved bootstrap policy forbids enabling it now. Basic MFA remains
available on Free and is already mandatory for the founder admin path.

## Named reachability triage of the remaining function warnings — 2026-07-29

The prior sections closed warnings in bulk. This section does what the plan's
Phase 4 gate actually asks for: name every remaining function finding and give
each one a caller-based disposition, rather than describing the residue as
"intentional".

### How the list was derived

Production has no direct read-only SQL path from the developer machine (the
IPv6-only `db.<ref>` endpoint is unreachable, and the production database
password is founder-held). The residual set was therefore reconstructed:

1. Enumerated the live catalog of the approved test project through the pooler
   with `scripts/security/pg-read.mjs`: 74 `public` SECURITY DEFINER functions
   currently hold `anon` and/or `authenticated` EXECUTE.
2. Applied the 66 `REVOKE EXECUTE` statements from the five separately approved
   revoke migrations (`20260824134000`, `135000`, `140000`, `141000`, `142000`),
   matching on normalized type-only signatures.

Result: **33 functions remain client-executable → 33 authenticated + 6 anon = 39
Advisor findings.** Advisor reports 41 function findings (43 total minus the
leaked-password and extension-in-public entries). The 2-finding gap is functions
created by migrations that the test project has not received — the parser flagged
`admin_account_directory(text,text,text,integer,integer)` as one such case — so
the named list below covers 39 of 41. Closing the last two requires either the
test project caught up on its 19 missing migrations or production SQL access.

### Anonymous execution — all 6 are required (no action)

These are the anon-facing product surfaces `20260824140000` deliberately
preserved. `public_local_businesses` is confirmed to genuinely need it:
`supabase/functions/public-local-businesses/index.ts` builds its client with
`SUPABASE_ANON_KEY`, not the service role.

| Function | Why anon execution is required |
| --- | --- |
| `public_local_businesses(text,text,integer)` | Edge function calls it on an anon-key client |
| `lookup_deal_share(text)` | Logged-out share/QR landing (`app/s/[code].tsx`, `deal-share-lookup`) |
| `is_publicly_visible_business(uuid)` | Referenced by live RLS policies evaluated for anon |
| `deal_claim_visible_to_business_owner(uuid)` | Referenced by live RLS policies |
| `customer_deal_localizations(uuid[],text)` | Logged-out deal card translation (`lib/customer-deal-localizations.ts`) |
| `customer_deal_poster_specs(uuid[])` | Logged-out poster rendering (`lib/customer-deal-poster-specs.ts`) |

### Authenticated execution — 10 are RLS policy dependencies (no action)

Live `pg_policies` inspection confirms each of these appears in a policy
`qual`/`with_check`. A policy predicate is evaluated as the calling role, so
revoking EXECUTE would break the policy, not harden it:

`admin_can`, `is_admin`, `is_owner_admin`, `is_business_owner`,
`is_business_member`, `is_active_redeemer_for_business`, `user_owns_business`,
`can_business_publish`, `get_business_capabilities`, `business_location_count`,
`location_cap_for_current_user`.

### Authenticated execution — 13 are intentional signed-in RPCs (no action)

Each has a direct app caller and is scoped internally to the caller's own
business or claim:

| Function | Caller |
| --- | --- |
| `get_my_business()` | `lib/owner-business.ts` |
| `merchant_business_insights(uuid)` | `app/(tabs)/dashboard.tsx` |
| `merchant_deal_insights(uuid)` | `app/deal-analytics/[id].tsx` |
| `business_repeat_visit_stats(uuid)` | `app/(tabs)/dashboard.tsx` |
| `business_saved_customers_count(uuid)` | `app/(tabs)/dashboard.tsx` |
| `deal_claim_counts(uuid[])` | `app/(tabs)/index.tsx`, `app/deal/[id].tsx` |
| `ai_compose_quota_status(uuid)` | `lib/ai-compose-offer.ts` |
| `get_location_billing_summary(uuid)` | `hooks/use-location-billing-summary.ts` |
| `report_business(uuid,text,text,uuid)` | `lib/reports.ts` |
| `report_user(uuid,text,text)` | `lib/reports.ts` |
| `preview_staff_redemption(text,text)` | `supabase/functions/staff-redemption` — forwards the caller's `Authorization` header, so the RPC runs as `authenticated` |
| `confirm_staff_redemption(text,text)` | same |

### Authenticated execution — 3 are closable, staged for approval

Live evidence: every caller is `prosecdef = true`, no RLS policy references
them, and no app/website/anon caller exists.

| Function | Callers (all SECURITY DEFINER) |
| --- | --- |
| `admin_role()` | `admin_can`, `is_admin`, `is_owner_admin` |
| `business_member_role(uuid)` | `is_business_member` |
| `get_runtime_billing_config()` | `activate_business_trial_from_checkout`, `admin_grant_location_trial`, `get_location_billing_summary`, `reserve_location_deal_credit`; plus `_shared/deal-translate-limit.ts` on the **service-role** client |

Staged, **not applied**:
`supabase/migrations/20260824144000_revoke_nested_definer_helper_client_execute.sql`,
with a source test at
`supabase/functions/_shared/nested-definer-helper-execute-migration.test.ts`.
Applying it is a separate approval. Expected effect: 43 warnings → 40.

### One open question, deliberately not closed

`validate_business_invite(text)` holds authenticated EXECUTE and **no caller was
found anywhere** — not in the app, website, Edge functions, other SQL function
bodies, or any RLS policy. "No caller found" is weaker evidence than "reached
only through definers", so it was excluded from `20260824144000`. It needs a
product decision on the invite gate (`20260706120000`): if the flow is dead, drop
the function; if it is dormant, revoke client execute and call it server-side.
