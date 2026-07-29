# Supabase Security Advisor warning triage — 2026-07-29

The initial production scan after migration `20260824131000` reported zero
errors and 171 warnings. The separately approved migrations `20260824132000`
and `20260824133000` reduced that to zero errors and 144 warnings. This ledger
separates completed zero-cost fixes from warnings that need reachability
analysis or a paid plan. It does not authorize any further production change.

| Rule | Count | Current disposition |
|---|---:|---|
| Authenticated users can execute SECURITY DEFINER function | 76 | Reachability review required. Sixty-six are also callable by anon; ten are authenticated-only. Many are intentional client RPCs or self-authorizing helpers, so a blanket revoke would break production. |
| Public can execute SECURITY DEFINER function | 66 | Reachability review required. Default EXECUTE grants are broader than ideal, but each function must be classified as public, client-authenticated, service-role-only, or trigger/internal before revocation. |
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

## Paid warning disposition

Supabase currently documents leaked-password protection as available on Pro
and above:

- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/pricing

The approved bootstrap policy forbids enabling it now. Basic MFA remains
available on Free and is already mandatory for the founder admin path.
