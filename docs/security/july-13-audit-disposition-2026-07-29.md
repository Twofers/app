# July 13 branch audit disposition

The recovered source is
`docs/qa/BRANCH_SECURITY_CODE_AUDIT_2026-07-13.md`; the recovered atomic-rate
proposal is `docs/qa/proposed-m2-atomic-rate-limit.sql`. The audit reports 37
raw findings, deduplicated into the 27 canonical groups below (several headings
explicitly consolidate multiple raw findings).

| Group | Disposition on 2026-07-29 | Evidence / remaining action |
|---|---|---|
| M1 | Fixed | Shared trusted client-IP parser and client-independent intake ceiling are present and tested. |
| M2 | Fixed in repository; production approval pending | `20260824130000_atomic_submission_rate_limit.sql` and both intake callers now use the advisory-lock RPC. |
| L1 | Fixed more strictly | Email quick preview/confirm now require the authenticated configured founder, owner role, and AAL2; the sealed same-origin proxy carries the session. |
| L2 | Fixed | Preview is authenticated and writes `admin_business_application_quick_previewed`. |
| L3 | Accepted residual | Token-state responses remain distinguishable, but the endpoint is now behind the founder/AAL2 guard and a 256-bit scoped token. |
| L4 | Fixed | Duplicate check is repeated after the processing claim. |
| L5 | Fixed | A completed decision is not made retryable when token bookkeeping fails. |
| L6 | Accepted by founder | Human-gated low-risk heuristic; revisit if approvals ever become automatic. |
| L7 | Fixed | Real consent booleans are persisted. |
| L8 | Accepted residual | Token arrives in the fragment and is removed before the first request; browser/extension exposure before script execution remains inherent to the email-link design. |
| L9 | Fixed | QA password input is native-launch-only and development-gated. |
| L10 | Accepted | Existing punctuation behavior is approved; only an invalid all-punctuation business name reaches the edge case. |
| L11 | Open, non-security | Additional offer-copy branch coverage is desirable but is outside this founder-security change. |
| L12 | Accepted, development-only | QA auto-login deliberately mirrors the real flow; release builds eliminate it. |
| L13 | Accepted/build-owned | No signing, version, or package change was found; keep the generated Gradle placement under build regression coverage. |
| I-CORS | Documented | CORS is not treated as authorization; founder guard and token checks carry the boundary. |
| I-BEARER | Fixed | Bearer token alone can no longer preview or approve. |
| I-HONEYPOT | Fixed | Honeypot response matches successful intake shape. |
| I-EMAILURL | Fixed | Quick-approval links are rendered only when HTTPS. |
| I-REFERRER | Accepted | Page meta and deployed header both resolve to `no-referrer`; keep header-order tests. |
| I-SCRIPTLOAD | Accepted | Fragment can remain until JavaScript executes; CSP must remain strict. |
| I-ONBOARDING | Open, product QA | Verify CTA visibility on the target device and large text; not an authorization issue. |
| I-AI | Approval record remains authoritative | The AI lock manifest, not this security pass, controls changes under the locked renderer. |
| I-GATE1 | Fixed | Source/behavioral tests pin expiry, reuse, founder auth, eligibility, and duplicate checks. |
| I-GATE2 | Open, test-depth | Add a UI-crawl 410 variant when that crawl is next revised. |
| I-FIXTURES | Open, test hygiene | Deriving duplicate screenshot fields remains a non-production cleanup. |
| I-I18N | Confirmed good | Quick-approval strings remain complete across en/es/ko. |

No recovered finding was silently dropped. Open entries are explicitly
non-production test/product hygiene; M2 is the only recovered security control
that still requires a production migration and function deployment.
