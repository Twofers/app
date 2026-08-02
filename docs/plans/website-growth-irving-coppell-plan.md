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

1. ~~Vercel: Framework Preset → "Other"~~ DONE 2026-08-02 (dashboard, with
   Dan signed in) + redeployed. Share previews are now live; see RESOLVED
   section below for the actual root cause.
2. ~~Cloudflare: Browser Cache TTL → "Respect existing headers"~~ NOT NEEDED
   — closed by the code change, verified 2026-08-02 with cache-busted probes:
   styles.css, all five JS files and both fonts serve
   `public, max-age=31536000, immutable` through Cloudflare, while HTML
   correctly stays `max-age=0, must-revalidate`. The 4h value in the original
   audit was Cloudflare filling in where the origin declared `max-age=0`;
   explicit origin headers now pass straight through, so no dashboard change
   is required. (Always probe with a `?cb=` buster — Cloudflare serves stale
   headers by extension and this fooled the live-verify harness once.)
3. ~~Cloudflare: allow AI *retrieval* crawlers~~ NO CHANGE NEEDED — the
   original audit finding was WRONG and is retracted. Verified in the CF
   dashboard 2026-08-02 (AI Crawl Control → Security + Signals):
   - Nothing is blocked at the edge. Every "Block Crawler" toggle is off.
   - The robots.txt Disallow list is *training* crawlers only (GPTBot,
     ClaudeBot, Google-Extended, CCBot, Bytespider, Applebot-Extended,
     Amazonbot, meta-externalagent). The *retrieval* agents that actually
     answer user questions are not blocked and are actively crawling:
     last 24h Claude-SearchBot 16, BingBot 9, ChatGPT-User 5, Googlebot 2,
     OAI-SearchBot 1 — all allowed, 0 unsuccessful, 0 robots.txt violations.
   - `Content-Signal: search=yes, ai-train=no, use=reference` already
     expresses exactly the intended split (indexable + citable, not trainable).
   - Cloudflare's own Agent Readiness scan scores **Bot Access Control 2/2
     (100)**. The config is already ideal; touching it would only make things
     worse.
4. `Access-Control-Allow-Origin: *` is added outside the repo (CF or Vercel
   dashboard) — optional tightening.
5. Git push of the release/1.0.2 website commits — held per checklist §10
   ("never push without explicit approval").
6. ~~Quick-approve unreachable~~ RESOLVED 2026-08-02 (commit 3bec8acc,
   deployed): scoring rebalanced (in-area +20, website +20) so a complete
   in-area application reaches 75 ≥ 70 and the admin email regains its
   one-click approve link; requires email + phone + in-area address +
   website, so the bar is as strict as before. Also added coppell /
   las colinas / valley ranch to the launch-area list — Coppell addresses
   previously auto-waitlisted (-40).

## Status — COMPLETE (one item pending a Dan dashboard toggle)

- [x] Plan written
- [x] A: share-preview function (self-test green, mutation-tested)
- [x] B: geo + copy sweep (11 keys ×3 locales, JSON-LD byte-matched, i18n gates green, browser pass ×3 langs ×2 widths)
- [x] C: form cut + hygiene (all gates green; +main-session fix: address now
      required client-side so applications can't auto-waitlist)
- [x] Gates green (i18n ×2, ui-crawl 42 routes ×2 viewports, e2e ×3 langs,
      ?v= inventory, JSON-LD parse, share-preview self-test)
- [x] Local visual pass EN/ES/KO ×2 widths
- [x] Committed 13bb6636 + routing-fix follow-up commit
- [x] Deployed to production (final deploy prebuilt; checklist §8 updated advice below)
- [x] Live verification: 28/28 harness checks pass; share page console-clean
      live in ES; fonts/styles/JS immutable confirmed with cache-busted probes
- [x] Memory + this tracker updated

## RESOLVED 2026-08-02 (commit 3b1e3e3f) — share previews are LIVE

Both remaining items are done:
- **Vercel Framework Preset flipped to "Other"** (dashboard, with Dan signed
  in) and redeployed. Necessary, but it turned out NOT to be the blocker.
- **Real root cause: Vercel resolves static files BEFORE any redirect or
  rewrite in vercel.json.** The deployed `s/index.html` captured every
  `/s/<code>` request, so the share code never reached the routing layer at
  all. Proven by a loose bot-gated diagnostic redirect that fired with
  `code=index.html` — the router only ever saw the literal `/s/index.html`.
- Fix: the template is inlined into the function (`api/_share-template.js`,
  generated + byte-drift-gated) and `scripts/prepare-deploy.mjs` prunes
  `static/s/` between build and deploy, leaving `/s/*` free for the rewrites.
  The pruner refuses to run unless the function and a fresh template exist.
- Deploy sequence is now build → prepare-deploy → deploy --prebuilt.
  Checklist §8 rewritten with the rationale; a plain `vercel deploy --prod`
  would silently reintroduce the bug.
- Live: 32/32 harness checks; every `/s` path returns
  `x-share-preview-match: query` from the function with the full page intact.

Residual (acceptable, stated plainly): the *injection* branch — a share code
that resolves to a live deal — has not been exercised against production
because prod currently has no live share code to test with. Extraction,
lookup, fail-open fallbacks and the page itself are all verified live; the
injection transform is unit- and mutation-tested against the real template
and its output was demonstrated with a synthetic valid payload. It will
exercise on the first real share.

## Post-mortem: the /s share-preview routing saga (2026-08-02)

Everything human-facing works. The ONE dormant piece: unfurl bots currently
get the same generic share card as before (never worse). Root cause chain:

1. The Vercel project (`v0-twofer-landing-page`, created by v0) has
   **Framework Preset = "nextjs"** in its dashboard settings even though the
   site is plain static + `/api` functions. `vercel.json`'s `framework: null`
   does NOT override it at the edge.
2. Under that preset, production EDGE routing rewrites `/s/<seg>` to
   `/s/index.html` BEFORE user redirects/rewrites run (proven: a
   pre-filesystem 307 redirect on `/s/:code` captured `code=index.html`;
   identical on the CF-bypassing *.vercel.app alias, so NOT Cloudflare).
   This mangling also swallowed the real file `/s/share.js` → relocated to
   root `/share-page.js` (fixed live).
3. Separately, the compiled route table appends `^/api(/.*)? → 404` after
   user rewrites, so rewrite-into-function may dead-end even without (2).

Current state is SELF-HEALING: a bot-UA 307 redirect `/s/:code` →
`/api/share-preview?code=:code` is live in the redirects phase. Today the
edge mangling makes it a no-op (bots see the generic card, humans see the
normal page). The function itself is LIVE and correct at
`/api/share-preview?code=<CODE>` (verified: injection, escaping, caching,
`x-share-preview-match` debug header).

**To activate deal-specific previews: Vercel dashboard → Project Settings →
Build & Development Settings → Framework Preset → "Other", then redeploy.**
Then verify: a `facebookexternalhit` UA fetch of `/s/<code>` should 307 to
the function and return deal OG tags (`x-share-preview-match: query`).

Deploy note: final deploys this session used `vercel build --prod --yes &&
vercel deploy --prebuilt --prod --yes` from `website/` (deterministic — the
deployed route table is exactly `.vercel/output/config.json`, inspectable
locally before shipping). Plain `vercel deploy --prod` also works; prebuilt
is preferred until the framework preset is fixed.
