# Web-attack-surface review — 2026-07-31

Scope: protection against **web-based attacks** — the Vercel-hosted website
(`website/`), the Supabase Edge Functions (`supabase/functions/`), CORS, CSRF,
XSS, SSRF, security headers, redirect handling, IDOR, and abuse/rate-limiting of
internet-facing endpoints. Separate from the account-takeover/backup/provider
work in `founder-security-hardening-plan-2026-07-29.md`.

Method: direct reading of the shared middleware plus five parallel deep-dive
passes (public `verify_jwt=false` functions; edge-function auth/authz/CORS/rate
limiting; SSRF/outbound fetch; website XSS/admin-auth; full website surface). The
findings that change the severity picture were **re-verified by hand** — noted
"(verified)" below.

## Verdict — revised

**The unauthenticated / anonymous surface is strong. The authenticated surface
has real gaps.** Correcting my first-pass summary: there are **no anonymous
Critical/High** paths (reaching paid AI/Stripe or cross-tenant data requires a
valid session and, for AI, an *approved* business — that gate holds). But once an
attacker holds a legitimate low-value session (a self-signed-up owner, or any
non-founder admin row), there are **three High-severity gaps**: unbounded AI cost
burn, a spoofable redeem lockout, and a Stripe-billing admin gate that skips the
founder-lock and MFA that every other admin function enforces.

None of this is anonymously exploitable, and much of it is latent (H-2 needs a
second admin to exist; M-3 needs a crafted email GoTrue may reject). But they
are real and worth fixing. The infrastructure is excellent — the issues are a
handful of endpoints that didn't adopt the good patterns the rest of the codebase
established.

### Already done well (keep these)
- **CORS fails closed** — origin omitted (never `*`, no `Allow-Credentials`
  anywhere) for unknown origins; single shared allowlist.
- **`_shared/client-ip.ts`** — spoof-resistant trusted-IP derivation (adopted
  everywhere except H-1).
- **Atomic DB limiters with global ceilings** on the public forms
  (`claim_submission_slot`, `consume_anonymous_endpoint_attempt`), fail-closed.
- **Admin gate `requireAdmin`** — founder-UUID lock + active row + mandatory MFA
  (AAL2) + RBAC + audit-logged denials, on all 24 `admin-*` functions *except the
  four Stripe ones* (H-2).
- **Admin session** — AES-256-GCM sealed `__Host-` HttpOnly SameSite=Strict
  cookie; Supabase token never reaches the browser; 8h absolute cap.
- **Stripe webhook** — signature + triple livemode/environment checks + replay
  dedupe + expected-price assertion. No findings.
- **SSRF** — `import-business-website` blocks all private/link-local/metadata IP
  ranges, per-hop redirect re-validation, size/timeout caps.
- **IDOR** — sampled 12 mutation endpoints; all enforce server-side ownership.
- **No website XSS / open redirect / leaked secrets**; honeypot + silent-success
  on public forms; PII scrubbing on analytics ingest.

## HIGH (authenticated-abuse; fix first)

**H-1 — `redeem-token` lockout keyed on spoofable leftmost X-Forwarded-For
(verified).** `redeem-token/index.ts:99-103` takes `x-forwarded-for.split(",")[0]`
— the attacker-controlled leftmost hop — the one file that never adopted
`_shared/client-ip.ts`. The value feeds the "10 fails / 5 min" lockout and the
`failed_redeem_attempts.ip_address` audit column. An authenticated owner rotating
the header per request never trips the lockout and writes arbitrary text into the
audit column. **Fix:** use `clientIpFromRequest`, add a business-scoped
client-independent ceiling. One-line import; helper already exists.

**H-2 — Stripe billing functions use a weaker local admin gate that skips
founder-lock + MFA (verified).** `stripe-customer-portal-session`,
`stripe-create-checkout-session`, `stripe-ensure-customer`, and
`stripe-backfill-customers` each define a local `activeAdminRole()` /
`adminCan*()` that checks only `admin_users.is_active` + role — **not**
`requireAdmin`. They skip `isFounderAdminUser`, `require_mfa`, `isAal2`, and the
deny-audit. Any principal with any active admin row (a future non-founder admin,
or the founder on a non-MFA session) can open a **customer-portal session for any
business** (full billing/payment-method access) and mint checkout sessions.
Latent today (founder is the only admin row) but a real authz inconsistency.
`stripe-backfill-customers` is additionally `ENABLE_STRIPE_BACKFILL`-gated (good);
the portal/checkout ones are not. **Fix:** route all four through `requireAdmin`.

**H-3 — `ai-studio-generate-draft` has no cap/cooldown on image generation
(verified).** `ai-studio-generate-draft/index.ts:832-858` does `getUser` +
ownership (`owner_id !== user.id → 403`), but no monthly cap, cooldown, or
per-account limit — unlike every sibling AI function. An onboarded owner scripts a
loop and burns unbounded Gemini image + text spend. The only cost backstop
(`ai-cost-budget.ts`) is per-call and **disabled by default**. **Fix:** add the
same monthly cap + cooldown the other AI functions use (ideally via the atomic
RPC pattern — see M-2).

## MEDIUM

**M-1 — `ai-business-lookup` rate-limits only the applicant path, not the owner
path** (`index.ts:285-289` vs `315-334`). An onboarded owner reaches Google Places
with no 429 limiter → burns the `GOOGLE_PLACES_API_KEY` bill. **Fix:** extend the
limiter to the owner branch.

**M-2 — AI monthly caps/cooldowns are non-atomic count-then-insert (TOCTOU)**
(`ai-generate-deal-copy`, `ai-deal-suggestions`, `ai-translate-deal`,
`ai-compose-offer`, `import-business-website` — the last documents it). Concurrent
requests all read the pre-insert count and pass; a 30/month cap becomes
"30 + burst". **Fix:** move onto the atomic `consume_*` RPC pattern the public
endpoints already use.

**M-3 — PostgREST `.or()` filter interpolates the user's email unescaped
(verified).** `update-business-profile-section:72`, `accept-business-terms:49`,
`set-promo-materials-authorization:70` build
`.or(\`user_id.eq.${userId},invited_email.eq.${email}\`)` with `email` only
`.trim().toLowerCase()`'d. PostgREST `or` grammar uses `,` `.` `(` `)`; a
registered address with those in a quoted local part (RFC 5322 permits
`"a,b"@x.com`) could inject an extra disjunct into the membership check — an
**authorization-bypass primitive on business editing**. Exploitability depends on
GoTrue's email validator. Note `admin-account-management:540` *already* strips
`[,%()]`. **Fix:** apply the same strip, or use quoted values / two queries.

**M-4 — Non-atomic counters allow limit overrun (verified).**
`business-claim-link/index.ts:136` checks `uses_count >= max_uses`, then `:213`
writes `uses_count + 1` (read-modify-write). Concurrent POSTs on one single-use
link each read the old value → **one link creates N `business_applications`
rows** (N approval emails / onboarding records). Same pattern on
`pin_failed_attempts` in `exit-redemption-mode` / `owner-redemption-security`
(mitigated only by the required 32-byte exit token). **Fix:** atomic
`UPDATE … SET n = n + 1 … RETURNING` or an RPC.

**M-5 — Public read endpoints with no rate limiting** — `public-local-businesses`
(no auth, no limiter, `p_limit` up to 250 → free directory scrape + DB load);
`qr-campaign-redirect` (every anon GET writes a scan row → analytics poisoning /
table growth, CSRF-able via simple GET); `deal-share-lookup` and
`business-activation-status` (the latter runs 3 DB queries incl. a JSONB
containment scan per unauth call). **Fix:** add per-IP/global caps via the
existing abuse-hash helper, failing closed.

**M-6 — `wallet-pass-webservice` reuses the service-role key as HMAC material**
(`index.ts:33`, documented for pass backward-compat). A service-key leak yields
forgeable pass tokens; rotation breaks all issued passes. The unauthenticated
serial-list endpoint (`:117-140`) matches Apple's spec (accepted). **Fix:**
migrate to a dedicated `WALLET_PASS_AUTH_SECRET` with a dual-verify window.

## Website (from the full website pass — see also headers below)

**F1 — Admin console + API not host-pinned — HIGH (latent, verified).**
`vercel.json` has no host routing, so `/admin*`, `/api/admin/session`,
`/api/admin/proxy` resolve on `twoferapp.com`, `www`, AND every `*.vercel.app`
preview — not just `admin.twoferapp.com`. The `__Host-` cookie binds to whichever
host the operator logged in on; on the no-CSP public origin a future XSS would run
same-origin with the admin session. Not exploitable today (no public XSS), but
removes the compounding factor. **Fix:** host-conditional rule limiting `/admin*`
+ `/api/admin/*` to `admin.twoferapp.com`. Pairs with the pending Cloudflare-Access
item in the founder plan.

**F3 — `quick-approve-trial` CSP omits `'self'`, breaking its own call — MED
(verified).** `connect-src https://…supabase.co` only, but the page fetches the
same-origin `/api/admin/proxy?function=admin-business-applications`. In enforcing
browsers the quick-approval POST is CSP-blocked and the page errors. **Fix:**
`connect-src 'self'`. Confirm against prod behavior first.

**F6 — Checkout redirect to API-supplied URL, no allowlist**
(`business/billing/checkout/checkout.js:62`). `window.location.href = payload.url`
with no scheme/host check. **Fix:** require
`new URL(payload.url).origin === 'https://checkout.stripe.com'`.

**F10 — Claim-token pages indexable/cacheable — LOW (verified).**
`/business/claim/:token` has the token in the path but no `robots` meta, no
`no-referrer`, no `no-store`, and isn't in robots.txt (unlike its billing/quick-
approve siblings). **Fix:** add the noindex meta + `no-referrer` + `no-store` +
robots.txt disallow.

**F7/F8 — Admin `href` from API without scheme/encoding guard — LOW**
(`admin.js:363`, `admin-directory.js:200,503,536`). DiD only (admin CSP blocks
`javascript:` today). **Fix:** assert `/`-or-http(s) prefix; `encodeURIComponent`.

**F13 — `/admin/app.html` publicly fetchable — LOW.** Signed-out shell was meant
to hide section/endpoint names; the full dashboard markup (structure, no data) is
a static GET. **Fix:** serve via authenticated function or accept + document.

**F12 — Vendored `admin/qrcode-browser.js` has no provenance** (served pre-MFA on
admin login). **Fix:** record upstream source/version/SHA-256.

**F14 — Dead session-storage plumbing** (`admin-shell.js` `TOKEN_KEYS` /
`storageSource`). Unused pre-cookie leftovers. **Fix:** remove.

## Security headers (one `vercel.json` edit)

- **No HSTS declared (F5).** Add `Strict-Transport-Security:
  max-age=63072000; includeSubDomains; preload` to the site-wide block. (Vercel
  likely injects a default, but it's not asserted and the admin subdomain makes
  `includeSubDomains` matter.)
- **No CSP on public pages (F2)** (`/`, `/s/*`, `/business/**`). Requires
  refactoring five inline sites first (`s/index.html`, `business/start-trial`,
  `business/index.html`, two inline `onerror=` in `index.html`). Ship
  `Content-Security-Policy-Report-Only` first, then enforce.
- **Header hardening (F11).** Extend `Permissions-Policy` (`payment=()`, `usb=()`,
  `browsing-topics=()`); add `Cross-Origin-Opener-Policy` + `Cross-Origin-Resource
  -Policy: same-origin`, esp. on admin; add `upgrade-insecure-requests` to admin
  CSP.

## LOW / hygiene

- **L-1 — Production CORS allowlist includes localhost dev origins**
  (`_shared/cors.ts:14-15`). A local process on `:8081`/`:19006` gets a same-origin
  channel to every function. **Fix:** env-gate the localhost origins.
- **L-2 — `Vary: Origin` never emitted** — with origin reflection, an intermediary
  cache could cross-serve `Allow-Origin`. Mostly `no-store` limits impact. **Fix:**
  add `Vary: Origin`.
- **L-4 — `claim-deal` counts only *successful* claims** (`:341-357`); failing
  calls are unmetered. **Fix:** add an attempt counter.
- **L-5 — `redeem-token` cross-tenant validity oracle** (`:298-312` → `:385`): the
  "does not belong to your business" message distinguishes non-existent from
  another-merchant's code. **Fix:** identical generic error for both.
- **L-6 — `sameOrigin()` trusts `x-forwarded-host`**
  (`website/server/admin-session.js:97-103`). Not browser-exploitable, but pin to
  an allowlisted host constant.
- **Cron secrets compared with `===`** (`weekly-deal-digest:42`, siblings).
  **Fix:** constant-time compare.
- **SSRF residual — DNS-rebinding TOCTOU** in `import-business-website` (resolve →
  fetch, Deno can't pin the IP). **Fix:** hard to fully close; **document** as
  accepted residual with compensating controls (auth, ownership, 10/24h cap,
  size/timeout).
- **`/r/:slug` query injection into rewrite** (`vercel.json:152-153`) — no impact
  today (function reads only `slug`); note for the future.

## Non-security bug (flag to the team)

**F4 — `website/api/admin/session.js:56-58`** reads `pending.issued_at` /
`pending.absolute_expires_at` before the `const pending` at line 63 — a
temporal-dead-zone `ReferenceError` (500) in the non-MFA sign-in branch.
Unreachable today (a password grant is never `aal2`) and fails closed, but breaks
the moment Supabase's aal behavior changes; the copied values are also
semantically wrong for a fresh login.

**F-INFO — `ai-extract-menu` `image_url`** validated only as `https://` + length,
not IP-range — informational, because OpenAI (not Twofer) performs that fetch.

## Suggested remediation order

1. **H-1** — `redeem-token` → `clientIpFromRequest` + business ceiling (one line).
2. **H-2** — route the four `stripe-*` billing functions through `requireAdmin`.
3. **H-3 / M-1** — cap + cooldown on `ai-studio-generate-draft`; extend the
   `ai-business-lookup` limiter to the owner path.
4. **F1** — host-pin `/admin*` + `/api/admin/*` to `admin.twoferapp.com`.
5. **F3 + F5 + F11** — quick-approve `connect-src 'self'`; HSTS; extra headers.
6. **M-4** — atomic `uses_count` / `pin_failed_attempts`.
7. **M-3** — strip/escape the interpolated `.or()` email filters.
8. **M-2 / M-5** — AI caps onto the atomic RPC; per-IP limits on the public reads.
9. **F2** — public CSP report-only, after converting the five inline sites.
10. **L-1..L-6, F4, F6, F7/8, F10, F12/13/14, cron const-time, SSRF residual** —
    hygiene/DiD.

None require production/provider approvals to author. Deploying edge-function and
website changes follows the usual deploy steps and
`docs/website-edit-checklist.md` (bump `?v=`); ship the public CSP report-only
before enforcing. Regression-test each auth/rate-limit change — the
`_shared/*-source.test.ts` suite is the right place to pin these.

## Implementation status — 2026-07-31

Implemented in this pass (code + regression tests; **not yet deployed** — deploy
and the one migration are founder-gated):

- **H-1** — `redeem-token` now uses `_shared/client-ip.ts` and adds a
  client-independent business failure ceiling. Test: `redeem-token-client-ip-source`.
- **H-2** — new `_shared/stripe-admin-gate.ts` (founder-lock + AAL2); all four
  `stripe-*` functions route their admin path through it. Test:
  `stripe-admin-gate-source`.
- **H-3 / M-1** — `ai-studio-generate-draft` gets a cooldown + monthly cap (new
  `studio_draft` quota scope); `ai-business-lookup` owner path now rate-limited.
  Test: `ai-cost-caps-source`.
- **M-3** — new `_shared/postgrest-or-filter.ts`; the three `.or()` email sites
  sanitized. **M-4** — new migration
  `20260824145000_consume_business_claim_link_use_rpc.sql` + `business-claim-link`
  consumes atomically. Test: `injection-and-atomic-counters-source`.
- **M-5** — new `_shared/anon-read-rate-limit.ts` (fail-open); applied to
  `business-activation-status`, `deal-share-lookup`, `qr-campaign-redirect`.
- **F3/F5/F11/F10/F6** — `vercel.json` HSTS + expanded Permissions-Policy +
  COOP/CORP + admin `upgrade-insecure-requests`; quick-approve `connect-src 'self'`;
  claim-page no-store/no-referrer/noindex + robots.txt; `checkout.js` Stripe-origin
  allowlist (cache-bust bumped). **F4** — `session.js` TDZ bug fixed.
- **L-1/L-2** — `cors.ts` gates localhost origins behind `ALLOW_LOCALHOST_CORS`
  and emits `Vary: Origin`. **L-3** — cron secret compares now constant-time
  (new `_shared/constant-time-equal.ts`). Test: `anon-hardening-source`.

Deliberately **not** changed (documented residuals):

- **F1** (host-pin admin) — deferred: hard-pinning to `admin.twoferapp.com` before
  that subdomain/Cloudflare-Access is live (still a founder task) would lock the
  founder out of admin. Apply the host-conditional `vercel.json` rule together
  with the DNS/Access cutover.
- **L-5** (redeem cross-tenant oracle) — kept: the distinguishing message is
  intentional, localized multi-merchant UX (`lib/i18n/api-messages.ts`), the codes
  are high-entropy (32^7), and exploiting needs an authenticated owner. Net risk
  below the UX cost of removing it.
- **DNS-rebinding TOCTOU** in `import-business-website` — accepted residual (Deno
  `fetch` can't pin the validated IP); compensating controls remain.
- **PIN-counter race** (`exit-redemption-mode` / `owner-redemption-security`) —
  lower priority; mitigated by the required 32-byte exit token. Follow-up: same
  atomic-RPC treatment as M-4.

Still open (larger / separate passes): **F2** public-page CSP (needs the five
inline-script sites refactored first — ship report-only), **F7/F8** admin `href`
scheme/encoding guards, **F12/F13/F14** (qrcode provenance, `/admin/app.html`
exposure, dead session plumbing).

Pre-deploy: run `docs/website-edit-checklist.md` (`check:website-ui`, e2e) for the
website changes; apply migration `20260824145000`; set `ALLOW_LOCALHOST_CORS=true`
in dev environments only. One unrelated pre-existing test failure remains
(`launch-signup-source` — a CRLF `\n`-matcher quirk on Windows, fails on a clean
tree, not touched here).
