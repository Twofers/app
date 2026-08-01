# Homepage redesign — evaluation + implementation plan (2026-08-01)

Status: DEPLOYED TO PRODUCTION (2026-08-01, Dan approved "deploy it") — all
phases built same day with defaults D1–D4, every automated check green
(`check:website-ui` 42 routes × 2 viewports, `test:e2e` en/es/ko ×2 including
against production, `check:website-i18n`, `check:i18n`), §9 live verification
passed in full. QA captures in
`qa-artifacts/website-homepage-redesign-2026-08-01/`. Remaining: **commit**
(Dan-gated; ~50 modified + 4 new files sit uncommitted on
`security/web-attack-hardening-2026-07-31` — move to their own branch).
D3 used its documented fallback (DOM-composed poster); swapping in a
pipeline-generated image later is a one-file change.

Goal (from Dan's brief): make `www.twoferapp.com`'s main page look like it was
designed by a top-tier human web team for a large company with a real design
budget. Dan's two explicit callouts: (1) the strawberry-matcha poster image is
bad, (2) app-store links in the hero are good, but repeating download CTAs
again mid-page is AI slop. Scope is the **main page only**, but everything
shipped must stay visually consistent with the other public pages (which share
`styles.css`).

---

## 1. Ground truth (read-only audit, 2026-08-01)

- The homepage is `website/index.html`, hand-written static HTML, styled by the
  shared `website/styles.css` (5,900 lines, included by 44 pages) under a
  `.home-page` scope (lines ~24–1090 + ~5760–5900). No framework, no build.
- All copy flows through `localization.js` (204 `home.*` keys × en/es/ko).
  `store-links.js` swaps official Apple/Google badge artwork per locale and
  reorders CTAs by platform; `data-i18n-src` swaps the hero phone screenshot
  per locale (`app-home-feed{,-es,-ko}.webp` all exist).
- **The strawberry-matcha image is `assets/app-ai-poster.webp`** — an
  AI-generated sample poster overlaid on the business photo band. It also
  carries a hard date: "REDEEM BY JUL 17, 5:44 PM" — stale since mid-July and
  guaranteed to go stale again after any fixed-date regeneration.
- All four stock/product photos return 200 in prod. The dark/empty bands in
  full-page screenshots are lazy-load capture artifacts, not broken images.
- `assets/photo-bakery-croissants.jpg` is **referenced nowhere** — an unused,
  good-looking asset.
- The penguin mascot (`twofer-mark.png`, and the og-card art) appears on the
  page only as a 34px nav/footer chip. The og-card tagline ("Live local
  specials / 2-for-1 deals nearby") doesn't match the site's own wording.
- **Typography is declared but not delivered**: `font-family: Inter, …` with
  no `@font-face` and no font `<link>` anywhere in `website/`. Every visitor
  gets their OS fallback (Segoe UI / Roboto / SF). Headings use variable-font
  mid-weights (`450`/`480`) that static system fonts don't have (they snap to
  400) plus very tight tracking (`-0.075em` h1 / `-0.065em` h2) tuned for a
  font that never loads. Confirmed live: computed h1 = weight 450 requested,
  letter-spacing −4.26px at 56.8px.
- Verification tooling exists and is documented in
  `docs/website-edit-checklist.md`: `npm run check:website-ui` (per-route
  desktop+mobile: console errors, broken images, overflow, EN→ES→KO),
  `npm run test:e2e`, `check:website-i18n`, `check:i18n` (wired into the
  Vercel build). Deploys run from `website/` and are Dan-gated.
- Cache discipline: CSS/JS carry `?v=` (styles.css is included by 44 pages —
  every page must be bumped together). **Images have no `?v=`**, so changed
  imagery must ship under a *new filename*, never overwrite the old name
  (Cloudflare + Vercel caching).

## 2. Evaluation

### 2.1 What already works — keep, don't churn

- **The palette is genuinely distinctive**: deep forest night `#09271f`,
  cream `#fbf7f1`, coral `#f08a54`, mint `#a7d9c7`, gold `#f3c65b`. It avoids
  every AI-template cliché (no purple gradients, no glassmorphism). Keep it.
- The hero headline — "Make slow hours feel like happy hour." — is a real,
  human line. Keep it.
- Real product screenshot in the hero phone, localized per language.
- Official store badges handled correctly (unmodified artwork, locale swap,
  CLS reservation) — this is licensing-constrained; do not restyle badges.
- Engineering quality is high: i18n ×3, JSON-LD (app + FAQ), iOS smart
  banner, skip link, aria labels, launch-signup fallback when store links go
  dark, `onerror` resilience on band images. None of this gets thrown away.
- Sticky pill nav + audience bar ("For Customers | For Businesses") is a
  legitimate human pattern (banks/telcos use it). Keep the structure.

### 2.2 What reads as templated / "AI slop" — the problems to fix

Ranked by impact on the "big-budget human" goal:

1. **No real typography (highest leverage).** The single biggest difference
   between a template and a designed site is a deliberate, actually-loaded
   typeface. Today the site renders in whatever the OS ships, with tracking
   and weights tuned for a font that isn't there — headings come out mushy
   (400 instead of 450+) and over-tightened on Windows/Android.
2. **Duplicate CTAs.** "Request Business Access" appears 4× (nav, hero,
   business panel, yellow band). App-download CTAs appear in 3 places (hero
   badges, customer-section text buttons, footer). Dan called out the
   customer-section repeat specifically. Footer repetition is normal web
   practice and stays; the mid-page repeat goes.
3. **The strawberry-matcha poster** (`app-ai-poster.webp`): unappetizing
   red/green layering, obviously AI-generated, redundant copy ("STRAWBERRY
   MATCHA SAVINGS" + "40% OFF STRAWBERRY MATCHA"), and a hard expiry date
   that's already a month stale on the marketing page.
4. **Twin numbered-card grids.** `benefit-row` (01/02/03 cards) and
   `step-grid` (01/02/03 cards) are the same visual pattern two sections
   apart, and their content overlaps ("Real-Time Updates" ≈ "Nearby customers
   see it live"). Repeating one layout module with number-chip + h3 + blurb is
   the canonical AI-landing-page tell.
5. **Verbatim copy repetition.** `home.promoKicker` ("AI-assisted promotion
   setup") renders twice in adjacent sections. `home.customersBody` and
   `home.faqA4` share the clunky phrase "local offers, bonus item offers, and
   limited-time deals" — internal deal-type taxonomy leaking into marketing
   voice. "Sample" is stamped on the page three times (hero chip, cold-brew
   card, console) — once is honest, three is nervous.
6. **The product's best moment is never shown.** Claim → show QR in store is
   the distinctive mechanic (it's even in the meta description) and nothing on
   the page depicts it. Meanwhile the "How Twofer Works" band is text-only
   cards, and the customer panel's main visual is a stock photo of coffee
   cups rather than the product.
7. **Decorative filler.** Two blur-circle "orbs" absolutely positioned behind
   the phone (on top of the band's own radial tints — double decoration), and
   two floating chips positioned with viewport-center math
   (`left: calc(50% − 300px)`) that drifts at in-between widths. This is the
   aesthetic Dan is reacting to: ornament that isn't anchored to anything.
8. **Photography has no shared grade.** Three stock photos from three worlds:
   cool/moody cafe interior, neutral top-down coffee toast, warm croissants on
   black slate. Big-budget sites grade imagery to one temperature.
9. **Micro-copy inconsistency.** "Free for customers." (trailing period) next
   to siblings without; h3 casing flips between Title Case ("Find Live
   Deals", "Real-Time Updates") and sentence case ("A business publishes a
   deal"); footer back-to-top is a literal `^` character; og-card tagline
   differs from the site's.
10. **The brand's own wit is unused.** "Twofer" literally means
    two-for-one, and the page never plays the "two" anywhere. The bow-tie
    penguin — a real, ownable mascot — never appears at meaningful size. The
    page could belong to any deals app; big-budget work owns its quirks.

## 3. Design principles for this redesign

1. **Type is the brand.** One properly loaded display face + one body face,
   correct weights, tracking re-tuned to the actual font. Korean falls back to
   system fonts by design (Korean webfonts cost megabytes).
2. **Show the product, not abstractions.** Real screens (localized) in hero,
   business console, and a claim→QR moment. Stock photos become supporting
   texture, never a section's payload.
3. **Every module appears once.** One numbered sequence max. One "Sample"
   disclosure max. Each CTA earns its placement: hero (download + business),
   business section (business), close (both), footer (echo).
4. **Ornament must be anchored.** Chips attach to the phone, not to viewport
   math. Kill free-floating blur orbs; the band gradients already do that job.
5. **One photographic temperature** (warm, matching cream/coral), via a shared
   CSS grade class or re-exported assets.
6. **Honest proof only.** No invented ratings, logos, or user counts. The
   honest proof: real screenshots, real approval process, "live in DFW",
   three languages, and a real generated ad made by the actual product.
7. **Sentence case everywhere** except nav labels and proper nouns; one
   punctuation style for fragments; minimal words (Dan's standing rule).

## 4. Decisions for Dan (defaults chosen — veto before Phase 1/2 starts)

| # | Decision | Default and why |
|---|---|---|
| D1 | Display typeface | **Bricolage Grotesque (variable, OFL, self-hosted)** for display + **Inter variable** for body/UI. Bricolage has the characterful, editorial big-budget feel and is legally safe to self-host. Alternative if Dan wants maximum safety: all-Inter (still a huge upgrade over unloaded fallbacks). Swap is one CSS token either way. |
| D2 | Hero layout | **Split hero**: copy left-aligned, phone right and cropped by the band edge (the DoorDash/Airbnb app-site pattern), chips anchored to the phone. Alternative: keep centered stack but fix chips/orbs — weaker, cheaper. |
| D3 | Poster replacement | **Generate the replacement with Twofer's own poster pipeline** from `photo-bakery-croissants.jpg`, offer "2 croissants for the price of 1" (a literal twofer), **no absolute date** on the artwork. Then show input photo → finished ad side by side, literally demonstrating "From a quick photo to a finished ad." Requires one Dan/dev run of the real generator; fallback: an HTML/CSS-composed poster (crisp at any DPI, never stale, trivially localized). |
| D4 | QR moment asset | Capture a claim/QR screen from the app (S10 `sh` skill) for the how-it-works band. Fallback: HTML/CSS mock QR card styled with app tokens. |

---

## 5. Phases

Each phase is independently shippable, runs the full
`docs/website-edit-checklist.md` (§7 local pass + §2 automated checks), and is
Dan-gated at deploy. Copy changes always land in `localization.js` ×3 (en/es/
ko — Spanish accents read by eye, never scripted). New/changed images ship
under **new filenames**. `styles.css` `?v=` bumps hit **all 44 including
pages**; `localization.js` bumps hit its 22.

### Phase 0 — Dan's callouts + hygiene (small, ship first)

- [x] Remove the duplicate app-download block from the customer section
      (`index.html` `.inline-cta`: both `data-store-cta` buttons + the
      `website-customers` launch-signup form). The section keeps its copy and
      visual; downloading stays hero + footer.
- [x] Replace `app-ai-poster.webp` per D3 under a new filename
      (`app-ai-poster-croissant.webp` or similar); update `src`, `alt`
      (×3 locales via `a11y.aiPosterShot`), and intrinsic `width`/`height`.
      No absolute dates in the artwork. Delete nothing until post-deploy
      verification passes.
- [x] De-duplicate `home.promoKicker`: the photo band gets its own kicker
      (e.g. en "Made with Twofer" / es / ko) instead of repeating
      "AI-assisted promotion setup" back-to-back.
- [x] Copy hygiene ×3 locales: drop the trailing period on
      `home.freeCustomers`; rewrite `home.customersBody` and `home.faqA4`
      (+ matching FAQ JSON-LD text in `index.html` head) so "local offers,
      bonus item offers, and limited-time deals" stops appearing verbatim
      twice; sentence-case `home.findTitle` / `home.realtimeTitle`
      (h3s: "Find live deals", "Real-time updates", "Support local").
- [x] Reduce "Sample" stamps from three to one: keep the cold-brew card's
      label; hero chip becomes deal-flavored ("Live now · 0.5 mi" pattern) or
      is removed with Phase 2; console status becomes "Preview". FAQ A2
      keeps the honest sample disclosure.
- [x] Verification: checklist §2 + §7; EN→ES→KO toggle on the changed
      strings; JSON-LD still parses; store CTAs on `/` still resolve.

### Phase 1 — Typography foundation (highest leverage; touches all public pages)

- [x] Add `website/assets/fonts/` with self-hosted variable woff2 files per
      D1 (latin + latin-ext subsets; total budget ≤ ~120 KB). Include license
      files alongside.
- [x] `styles.css`: `@font-face` blocks with `font-display: swap` and
      metric-override descriptors (`ascent-override` etc.) on the fallback to
      minimize swap CLS; tokens `--font-display` / `--font-body`; body keeps
      full system fallback chain so Korean renders system-native (the
      existing `[lang="ko"]` h1 override stays).
- [x] Re-tune display type for the real font: h1/h2 weights to real values
      (e.g. 500–600), tracking from −0.075em/−0.065em to what the chosen face
      needs (start ~−0.03em, judge by eye at 1366 and 390), keep the existing
      clamp scales.
- [x] `<link rel="preload" as="font" crossorigin>` for the display+body files
      on high-traffic public heads: `/`, `/support`, `/business/start-trial`,
      `/s` (others load via CSS on demand).
- [x] Spot-check shared-CSS blast radius: all public routes via
      `check:website-ui`, plus one admin page by eye (admin inherits the body
      font — acceptable, but must not break layout).
- [x] Bump `styles.css?v=` on all 44 pages (grep inventory from the
      checklist §3).

### Phase 2 — Hero recomposition (per D2)

- [x] `index.html` + scoped CSS: two-column hero (copy left, phone right,
      cropped by band bottom edge); left-align copy, CTAs, and trust list on
      desktop; stacked centered on ≤720px (uncropped phone).
- [x] Delete `.stage-orb-*`; keep/retune the band's radial tints. Anchor the
      one remaining chip to the phone shell (absolute within
      `.phone-shell`'s parent, no `calc(50% − Npx)`).
- [x] Fix nested `<aside>` semantics (`.hero-stage` stays `aside`,
      `.phone-shell` becomes `div`/`figure` with a small caption — the single
      sample disclosure if the chip route isn't kept).
- [x] Hero copy pass ×3: keep the headline; tighten `home.lede` (remove
      deal-taxonomy phrasing; one sentence, both audiences).
- [x] Keep `data-i18n-src` per-locale screenshots and the badge CLS
      reservation (`min-height: 60px`) working in the new layout.
- [x] Verify LCP element (h1 or phone image) still has `fetchpriority`
      /preload as appropriate; no CLS regressions at 1366/390.

### Phase 3 — Customer story: product over stock

- [x] Rebuild `.customer-visual` around the product: the real deal-card UI
      (from the localized app screenshots) with claim state, with
      `photo-cafe-coffee.jpg` demoted to backdrop texture under the shared
      warm-grade class (new `.photo-grade` filter class in home scope).
- [x] Fold `benefit-row`'s three cards into the customer panel as a compact
      checklist (reuse trust-list styling) and **delete the standalone
      numbered grid** — resolves the twin-grid tell (§2.2-4). Locale keys
      reworded ×3, sentence case.
- [x] The cold-brew float card keeps the single "Sample" label (per Phase 0).

### Phase 4 — Business story: show, don't tell

- [x] ~~Business console upgrade: render the D3 croissant poster thumbnail
      inside step 01/03~~ DEVIATED on purpose: the rebuilt photo band directly
      below already shows the full poster; a thumbnail in the console would
      repeat the same artwork twice in one viewport, violating §3.3 ("every
      module appears once"). Console kept its three steps; its status chip
      changed "Sample" → "Preview".
- [x] Photo band becomes the input→output moment: croissants photo ("the
      quick photo") beside the finished poster ("the finished ad"), one line
      of copy, new kicker from Phase 0. `photo-cafe-interior.jpg` retires
      from the homepage or moves under the warm grade elsewhere — one
      temperature per §3.5.
- [x] Keep `onerror` resilience handlers on all band imagery.

### Phase 5 — How it works, close, FAQ, footer

- [x] "How Twofer Works" keeps the dark band + 3 steps but each step gets a
      small visual frame (publish console detail → live deal card → claim/QR
      screen per D4). This is now the page's only numbered sequence.
- [x] Final CTA panel (yellow, distinctive — keep) becomes the dual-audience
      close: business CTA primary + one quiet "just want the deals? it's
      free" line linking `#get-the-app`; penguin mascot appears here at
      meaningful size — its one moment on the page.
- [x] FAQ polish: custom summary chevron (replace default marker), hover
      state, tightened answers (mirror any text change into head JSON-LD).
- [x] Footer: brand+tagline / Product / Businesses / Legal columns, language
      row, `^` replaced with an inline SVG chevron, store text links stay.
      Tagline unified with the hero's wording (og-card regeneration optional,
      separate low-priority asset task).

### Phase 6 — Motion (small, last)

- [x] Tiny `home-motion.js?v=` (new versioned file → checklist §3 inventory
      update): IntersectionObserver adds a `.revealed` class for staggered
      fade/rise on section entries. Default state fully visible without JS;
      animations only inside `@media (prefers-reduced-motion: no-preference)`.
      Existing phone-enter animation and hover lifts remain.

### Phase 7 — Full-sweep verification + deploy

- [x] Full `docs/website-edit-checklist.md` top to bottom: scope guard,
      `check:website-ui`, `test:e2e`, `check:website-i18n`, `check:i18n`,
      cache-bust inventory grep (one version per file), store-CTA
      invariants, JSON-LD parse, local visual pass at 1366 + 390 ×3 locales.
- [x] Fresh-eyes pass as a first-time visitor (Dan's standing QA rule):
      every section earns its place, no repeated module, minimal words.
- [x] Deploy from `website/` on Dan's go (approved + deployed 2026-08-01
      ~13:02 CT, target production, status Ready); checklist §9 live
      verification passed: new `?v=` serving, fonts/mascot/home-motion 200,
      infra sweep 4×200 with correct content types, prod console clean,
      Bricolage+Inter confirmed loading on prod, e2e suite green against
      `https://www.twoferapp.com` (en/es/ko), `/s/AAAAAAA` renders the
      shared-offer fallback correctly. `<lastmod>` already 2026-08-01.
- [ ] Commit only when Dan asks (repo rule; work currently sits on
      `security/web-attack-hardening-2026-07-31` — put website work on its
      own branch when committing).

## 6. Guardrails (do not regress)

- Palette, i18n architecture, JSON-LD/FAQ parity, iOS smart banner, skip
  link, launch-signup fallback, badge artwork rules (never recolor/crop/
  restyle official badges), `.home-page` scoping discipline (admin and other
  public pages must not shift except the intentional font upgrade).
- No fabricated social proof — no fake ratings, logos, or counts, ever.
- No absolute dates in any static marketing asset.
- Images change filename when content changes; CSS/JS bump `?v=` everywhere
  they're included.

## 7. Rollback

Every phase is a plain static-file change: `git revert` the phase commit and
redeploy from `website/`. Fonts and new images are additive files — reverting
references is sufficient; old assets are kept until post-deploy verification
passes, so same-name cache poisoning can't occur.

## 8. Implementation notes (2026-08-01)

- **New files**: `assets/fonts/` (Bricolage Grotesque v9 + Inter v20, latin +
  latin-ext variable woff2, two OFL licenses; typical visitor transfers only
  the two latin files ≈150 KB, ext subsets gated by `unicode-range`),
  `home-motion.js` (registered in the checklist §3 inventory),
  `assets/twofer-mascot-360.webp` (derived from `twofer-logo.png`: white
  background removed via border-connected flood fill so the belly stays
  white, trimmed, 263×360, 13 KB). `app-ai-poster.webp` and
  `photo-cafe-interior.jpg` are now unreferenced but deliberately kept on
  disk until post-deploy verification passes.
- **Poster (D3 fallback)**: the sample ad is DOM-composed in the photo band
  (`.ad-poster`) from `photo-bakery-croissants.jpg` — "Cedar & Bean / 2 for 1
  croissants / Buy one, get one free / Today · 2–5 PM", localized ×3, no
  absolute dates. The QR in step 03 is a real scannable 25×25 QR encoding
  `https://www.twoferapp.com`, inlined as a 2 KB SVG.
- **e2e recalibration**: `scripts/e2e-smoke.js` `MIN_TRANSLATED` lowered
  25 → 15 (commented in-file). The redesign removed duplicated copy, so the
  page now has ~19 distinct translated strings; the per-key mismatch
  assertion — the real guard — still verifies every visible string.
- **QA findings fixed during the visual pass**: mascot rendered on a white
  box (source PNG had opaque background); the band input photo rendered
  192×720 because the HTML `height` attribute defeats CSS `aspect-ratio`
  (fixed with `height: auto`); the page-level `.step-grid span` chip rule
  bled gold/coral into the step mini-frames (scoped to `article > span` +
  explicit colors); scroll reveals left sections invisible in full-page
  screenshots and print (fixed: 20% pre-reveal rootMargin, immediate reveal
  of anything at/above the viewport on load, `beforeprint` hook, and an
  `@media print` force-visible rule).
- **Sample business name** shortened to "Cedar & Bean" — "Cafe" trips the
  Spanish diacritics guard, and per that guard's own doctrine the check was
  not weakened for a proper noun.
- **Checklist updated** (§3): new `home-motion.js` row + the new-filename
  rule for images/fonts.
