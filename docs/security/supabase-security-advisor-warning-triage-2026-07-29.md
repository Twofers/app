# Supabase Security Advisor warning triage — 2026-07-29

The initial production scan after migration `20260824131000` reported zero
errors and 171 warnings. The separately approved migrations `20260824132000`,
`20260824133000`, and `20260824134000` reduced that to zero errors and 118
warnings. This ledger separates completed zero-cost fixes from warnings that
need reachability analysis or a paid plan. It does not authorize any further
production change.

| Rule | Count | Current disposition |
|---|---:|---|
| Authenticated users can execute SECURITY DEFINER function | 63 (was 76) | Thirteen trigger-only findings were closed by separately approved migration `20260824134000`. Twenty-two more functions have explicit service-role-only repository contracts; migration `20260824135000` is staged to remove their live client-grant drift. If approved, this count should fall to 41. |
| Public can execute SECURITY DEFINER function | 53 (was 66) | The same 22 service-role-only functions are anonymously executable in production despite trusted-only callers and repository grant tests. Migration `20260824135000` is staged to close them. If approved, this count should fall to 31. |
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
`20260824135000_revoke_service_role_function_client_execute.sql` is staged
with a two-test static gate. It only revokes `PUBLIC`, `anon`, and
`authenticated` execution while preserving service-role access, function
bodies, signatures, and data. Production remains separately approval-gated.
Expected Advisor result after application is 0 errors and 74 warnings, down
from 118.

## Paid warning disposition

Supabase currently documents leaked-password protection as available on Pro
and above:

- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/pricing

The approved bootstrap policy forbids enabling it now. Basic MFA remains
available on Free and is already mandatory for the founder admin path.
