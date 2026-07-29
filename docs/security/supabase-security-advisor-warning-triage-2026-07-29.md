# Supabase Security Advisor warning triage — 2026-07-29

The production scan after migration `20260824131000` reports zero errors and
171 warnings. This ledger separates clear zero-cost fixes from warnings that
need reachability analysis or a paid plan. It does not authorize any production
change.

| Rule | Count | Current disposition |
|---|---:|---|
| Authenticated users can execute SECURITY DEFINER function | 76 | Reachability review required. Sixty-six are also callable by anon; ten are authenticated-only. Many are intentional client RPCs or self-authorizing helpers, so a blanket revoke would break production. |
| Public can execute SECURITY DEFINER function | 66 | Reachability review required. Default EXECUTE grants are broader than ideal, but each function must be classified as public, client-authenticated, service-role-only, or trigger/internal before revocation. |
| Function search path mutable | 25 | Zero-cost candidate. Twenty-two definitions are migration-tracked; three legacy functions (`get_best_time_day`, `get_business_dashboard`, and `rate_limit_hit`) are production drift. Pinning requires a definition/dependency audit first. |
| Public bucket allows listing | 2 | Clear zero-cost fix staged as `20260824132000_remove_public_bucket_listing_policies.sql`. Both buckets remain public, owner write policies remain intact, and repo clients do not call `list()` on either bucket. |
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
policies. Added recurring cost is $0. The compatibility risk is limited to an
unknown external client that enumerates bucket paths; no such client exists in
the repository.

## Paid warning disposition

Supabase currently documents leaked-password protection as available on Pro
and above:

- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/pricing

The approved bootstrap policy forbids enabling it now. Basic MFA remains
available on Free and is already mandatory for the founder admin path.
