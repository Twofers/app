# Live site verification — 2026-07-31

Answers the plan's open question after the PR #25 merge shipped 74 website
files: *"Verify the live site — the change includes a 1,700-line `styles.css`
rewrite, CSP/header changes, and the admin console redesign."*

Method: `docs/website-edit-checklist.md` step 9, plus byte-level comparison of
live responses against `origin/main`, plus header probes taken both through
`www.twoferapp.com` (Cloudflare) and directly at the Vercel origin.

## Headline

**The public site is current and healthy. The admin console is not — production
is still running the deployment made before `d4e027ed`, so none of the admin
session hardening is live.**

Merging to `main` did **not** trigger a production deploy. That is the answer to
the plan's other open question ("`main` most likely auto-deploys") and it is the
outcome Phase 6 wants, arrived at by accident rather than by configuration.

## The deploy gap

Last production deploy: **2026-07-29 ~00:41 UTC**. Commit `d4e027ed`
*"security: harden founder admin and recovery"* landed **2026-07-29 22:01 UTC**,
reached `main` with PR #25 on 2026-07-31, and has never been deployed.

Its 15 website files are the entire admin session-hardening change: the rewritten
`admin-login.js` (367 lines), `admin-shell.js`, `admin-guard.js`, the new
server-side `api/admin/session.js`, `api/admin/proxy.js`, `server/admin-session.js`,
and the `vercel.json` `/admin` `Cache-Control` header.

Three independent confirmations, not inference:

| Check | Expected if deployed | Live |
| --- | --- | --- |
| `POST /api/admin/session` | 200/4xx from the session endpoint | **404** |
| `POST /api/admin/proxy` | 200/4xx from the proxy | **404** |
| `/admin/login/` markup | no "Keep me signed in" checkbox (`d4e027ed` removed it) | **checkbox present** |
| `/admin/*` `Cache-Control` | `no-store, private, max-age=0` | `public, max-age=0, must-revalidate` |

The fourth row is worth being precise about, because it initially looked like a
Vercel bug. It is not. Every live `Cache-Control` value matches the
**pre-`d4e027ed`** `vercel.json` exactly — `/admin(.*)` had no `Cache-Control`
rule then, so Vercel's static default is the correct response for the config
that is actually deployed. `/quick-approve-trial(.*)` → `no-store`, `/r/:slug` →
`no-store, private, max-age=0`, `/assets/(.*)` and `/favicon.ico` →
`public, max-age=86400, stale-while-revalidate=604800` all match that same older
file. One cause, four symptoms.

### What this means for the plan

Three Phase 5 items are marked `[x] [DEV]` and are true of the repository but
**not of production**:

- Same-origin backend session replacing browser-stored Supabase tokens.
- Removal of "Remember me".
- `Cache-Control: no-store` on `/admin(.*)`.

Until that deploy happens, an admin who ticks "Keep me signed in on this
browser" still has a Supabase **refresh token stored in the browser** — the
exact condition the sealed-cookie work exists to remove.

### Before deploying

`d4e027ed` changed `admin-login.js` (367 lines) and `admin-shell.js` (126 lines)
without bumping their `?v=` — checklist step 3. The practical risk is nil here
because the current `/admin` responses carry `max-age=0, must-revalidate`, so
browsers revalidate every request. Bump them anyway rather than depending on
that, since the same deploy introduces `no-store` and changes the reasoning.

## What is verified good

### Content is current

Live responses compared byte-for-byte against `origin/main`:

| File | Result |
| --- | --- |
| `/` (index.html) | identical apart from Cloudflare's email-obfuscation rewrite of `support@twoferapp.com` |
| `/styles.css` | **identical**, 109,370 bytes (the 1,700-line rewrite is live) |
| `/localization.js` | **identical**, 114,449 bytes |

Asset versions match the repo inventory exactly: `styles.css?v=20260728-account-growth`
(44 pages), `localization.js?v=20260726-billing-copy` (22), `store-links.js?v=20260722-es-polish`
(5), `launch-signup.js?v=20260707-launch-signup` (1).

### Security headers

Global (`/(.*)`): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`,
`Strict-Transport-Security: max-age=63072000`.

`/admin(.*)`: strict CSP and `X-Robots-Tag: noindex, nofollow` are live, and the
CSP is **doing work** — Cloudflare injects its analytics beacon
(`static.cloudflareinsights.com`) into admin pages and `script-src 'self'`
blocks it from executing (`beaconExecuted: false` with the tag present). Cost is
a CSP console error on every admin page load; either exclude `/admin` from
Cloudflare Web Analytics or accept the noise.

`/quick-approve-trial(.*)`: `no-store`, `no-referrer`, `noindex`, and its
tighter CSP (`form-action 'none'`, `base-uri 'none'`) are all live.

### Automated gates

- **Production e2e smoke** (`E2E_BASE_URL=https://www.twoferapp.com npm run test:e2e`):
  all green across en/es/ko — 63 visible strings per locale with 60 changing
  between locales, App Store `id6765769303`, Play `com.unvmex2.twoforone`, four
  trial CTAs → `/business/start-trial` (200), `/support` `/privacy` `/terms` 200.
- **UI crawl** (`npm run check:website-ui`): 42 routes × desktop 1366 + mobile
  390, passed. Run against the local tree, which is byte-identical to what is
  live for every shared asset.
- **Infra sweep**: `/sitemap.xml` 200 `application/xml`, `/robots.txt` 200
  `text/plain`, `/.well-known/apple-app-site-association` 200 `application/json`,
  `/.well-known/assetlinks.json` 200 `application/json`, unknown path → 404.

### Homepage in a real browser

711 CSS rules loaded from the live stylesheet; no broken images (0 of 8); no
horizontal overflow at 1280 or 375 px and no element wider than the viewport;
both JSON-LD blocks parse (`MobileApplication`, `FAQPage`); all six
`data-store-cta` anchors resolve to the correct store URLs; `apple-itunes-app`
meta present; mobile nav button present; `h1` scales 90.9 px → 54.4 px.

## Recommended order

1. Bump `?v=` for `admin-shell.js` (22 admin pages) and `admin-login.js` (login page).
2. Deploy from `website/` per checklist step 8 — this is the gated step.
3. Re-run the four checks in the deploy-gap table; all four should flip.
4. Then Phase 5's three items are true of production, not just of `main`.
