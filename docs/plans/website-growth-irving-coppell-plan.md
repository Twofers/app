# Website growth changes — Irving & Coppell (2026-08-01)

**Status: IN PROGRESS** — this file is the tracker (project convention).
Goal (Dan, via /goal): ship the six growth changes from the 2026-08-01 live audit,
with launch geography **Irving & Coppell** (not Dallas–Fort Worth), Opus subagents
implement, main session verifies, then deploy to production and live-verify.

Branch: `release/1.0.2` (website commits land here per recent history).
Deploy: `cd website && npx vercel deploy --prod --yes` (checklist §8).
All gates in `docs/website-edit-checklist.md` apply.

## Scope

1. **Share previews** — `/s/<code>` serves deal-specific OG tags (deal title,
   business name, end time) via a new Vercel function wrapping the existing
   `deal-share-lookup` edge function. No backend/RPC changes; the fixed public
   projection (audit F-009) is used as-is. `og:image` stays the brand card
   (the projection exposes no deal image; do NOT widen it).
2. **Geo sweep** — every public "Dallas-Fort Worth" mention becomes
   Irving & Coppell (EN "Irving & Coppell", ES "Irving y Coppell", KO keeps
   Latin names per existing convention). Metro kept as secondary context in
   meta descriptions ("in the Dallas-Fort Worth area") for metro-level SEO.
   Title tag gains geography. JSON-LD stays in sync with visible copy.
3. **Founding-merchant line** on /business/start-trial (truthful, no invented
   incentives — no pricing/trial-length promises Dan hasn't approved).
4. **Start-trial form cut** — remove `business_type`, `launch_area`,
   `slow_hours`, `offer_interests`. KEEP: business_name, contact_name, email,
   phone, address (feeds `missing_address` risk scoring), website_or_instagram
   (used for vetting), honeypot, promo_materials_authorized, terms, privacy.
   Server (`submit-business-application`) treats removed fields as optional —
   re-verify before removal.
5. **Cache policy** — fonts + query-versioned root JS/CSS get long immutable
   Cache-Control in vercel.json. (Cloudflare Browser-TTL override needs a
   dashboard change — see "Dan follow-ups".)
6. **CSP for public pages** — enforced, on a source pattern that EXCLUDES
   /admin, /quick-approve-trial, /api (those keep their own). Site has zero
   external scripts/styles (verified; only external ref sitewide is a
   billing.stripe.com link). Verify no inline script/style on any public page
   before enforcing; fallback to Report-Only if any page can't be cleaned.
7. **Cleanup** — dead pre-launch email-signup form + `launch-signup.js`
   removed from homepage (file deleted; only `/` used it);
   `/business/waitlist` dropped from sitemap (page stays live).

Out of scope: admin pages (incl. its one Dallas placeholder), styles.css,
sample poster copy (Cedar & Bean etc. — public-copy guard), robots.txt
(AI-crawler block is Cloudflare-managed), ACAO header (not set in repo).

## Work packages

- **A (Opus, parallel): share-preview function.**
  New `website/api/share-preview.js` + `website/api/_share-preview-core.js`
  (pure injector, HTML-escaped) + `website/scripts/check-share-preview.mjs`
  (node self-test). vercel.json: rewrites for /s routing + `functions`
  includeFiles for the template. Fallbacks: invalid/failed lookup → untouched
  template; template read failure → 302 to /s. Short s-maxage CDN cache to
  keep bot traffic off the rate-limited lookup.
- **B (Opus, parallel): geo + copy.** index.html (title/meta/og/JSON-LD ×2/
  status pill/FAQ/footer), localization.js (~30 refs ×3 langs + home.title),
  business/index.html, business/waitlist/index.html, business/start-trial
  (chip3 + founding line), sitemap lastmod. Bump localization.js `?v=` on all
  22 including pages → `20260802-irving-coppell`.
- **C (Opus, after A+B): form cut + hygiene.** start-trial form fields +
  matching localization.js key deletions ×3; homepage signup-form removal +
  delete launch-signup.js; sitemap waitlist removal; vercel.json cache
  headers + public CSP.
- **Verify (main session):** full checklist — check:i18n, check:website-i18n,
  check:website-ui, test:e2e, ?v= inventory grep, JSON-LD parse, local visual
  pass (EN/ES/KO), git diff review; commit (scope-guarded); deploy; checklist
  §9 live verification + share-preview OG curl checks + CSP/cache header
  checks + admin CSP unchanged.

## Dan follow-ups (dashboard-only, cannot be done from repo)

- Cloudflare: Browser Cache TTL → "Respect existing headers" (currently 4h
  override defeats the new immutable caching).
- Cloudflare: allow AI *retrieval* crawlers (managed robots.txt currently
  blocks GPTBot/ClaudeBot/etc. entirely); keep ai-train=no if desired.
- `Access-Control-Allow-Origin: *` is added outside the repo (CF or Vercel
  dashboard) — optional tightening.
- Git push of the release/1.0.2 website commit — held per checklist §10
  ("never push without explicit approval").

## Status

- [x] Plan written
- [x] A: share-preview function (self-test green, mutation-tested; includeFiles + route pattern still need live-deploy proof)
- [x] B: geo + copy sweep (11 keys ×3 locales, JSON-LD byte-matched, i18n gates green, browser pass ×3 langs ×2 widths)
- [ ] C: form cut + hygiene
- [ ] Gates green (i18n ×2, ui-crawl, e2e, ?v= inventory, JSON-LD)
- [ ] Local visual pass EN/ES/KO
- [ ] Committed (scope-guarded)
- [ ] Deployed to production
- [ ] Live verification (§9 + share OG + CSP + cache headers)
- [ ] Memory + this tracker updated
