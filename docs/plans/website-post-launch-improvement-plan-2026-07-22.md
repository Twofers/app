# Website post-launch improvement plan — 2026-07-22

Review of www.twoferapp.com (live site + `website/` source) now that Twofer is on
both stores. Desktop and mobile (375px) were both checked.

> **DECIDED AND SHIPPED 2026-07-22.** Dan approved W1-W9 and W11; W12 and W13
> were declined (kept as recommended); W10 stays parked until real ratings
> exist. W4 shipped as variant (b), platform detect. W14/W15 remain open —
> they are store-console actions, not website work.
> Commits `1e7fad06` (the pass) and `160cfd2f` (cache-param fix), deployed to
> Vercel prod `dpl_F7mwB2W2XS6rXYNDax5Rcfq5rLUg`. This file is now a decision
> record; the Decision lines below are kept as the audit trail.

**How to use this file:** each item has a Decision line. Mark `[x]` on YES or NO
(any editor works), save, and hand the file back. Items are independent — approve
any subset. IDs (W1…) are stable; "yes to W1, W4, W6" in chat works too.

**Verified healthy — no action needed** (checked 2026-07-22, live site):

- Localization parity is perfect: 373 keys × en/es/ko, every HTML key resolves.
- Universal/app links: AASA (Team `L9DT756YSN`, `/s/*`) and `assetlinks.json`
  both serve 200 with correct content type.
- sitemap.xml, robots.txt, 404 page (noindex) all correct.
- No missing/broken assets, no console errors, no horizontal overflow at 375px.
- `npm run check:website-ui` passes (37 routes × desktop + mobile).
- Store CTAs live and correct on `/`, `/s`, checkout; smart banner on `/` + `/s`.

---

## A. Gaps found during review (recommend YES)

### W1. Merchant "thanks" page tells people to download the app but gives no way to do it
`business/thanks/index.html` step 2 reads "Download Twofer for iPhone or Android
while you wait" — as plain text. No buttons, no links. Every approved merchant
reads this page at the exact moment they should install the app.
**Change:** add the two `data-store-cta` buttons + the `store-links.js` include
(same pattern as `/s`).
**Files:** `business/thanks/index.html`. Effort S. Risk: none (reuses existing JS).

**Decision:** [ ] YES   [ ] NO

### W2. Search engines and no-JS visitors see `mailto:` instead of store links
All 8 store-CTA anchors hardcode `href="mailto:support@twoferapp.com?…"` and rely
on JS to swap in the real URL. Crawlers indexing the page see a mailto, not links
to your store listings.
**Change:** put the real App Store / Play URLs directly in the HTML `href`s
(store-links.js still rewrites/hides as before — behavior identical with JS on).
**Files:** `index.html` (4 anchors), `s/index.html` (2), `business/billing/checkout/index.html` (2). Effort S. Risk: none.

**Decision:** [ ] YES   [ ] NO

### W3. Support page has zero path to the app
`/support` mentions app actions ("open the app, go to Settings…") but has no
store links and no smart banner. A customer who lands on Support from Google
can't get the app from there.
**Change:** add the `apple-itunes-app` meta + a small "Get the app" CTA row
(two store buttons) near the bottom.
**Files:** `support/index.html`. Effort S. Risk: none.

**Decision:** [ ] YES   [ ] NO

### W4. Hero shows "Get Twofer for Android" first — even to iPhone visitors
The hero lists Android first, iPhone second; the customer section further down
lists iPhone first — inconsistent with itself, and most US visitors are on
iPhone. Two options:

- **(a) Static swap** — iPhone first everywhere. One-line HTML moves. Effort S.
- **(b) Platform detect** — small JS in store-links.js puts the visitor's own
  platform first (Android phone sees Android first). Effort M.

**Decision:** [ ] YES — (a) static iOS-first   [ ] YES — (b) platform detect   [ ] NO

### W5. Tap targets below accessibility minimums on mobile
Language buttons are 30×22px; footer links are 17px tall. WCAG 2.2 AA minimum is
24×24px; Apple recommends 44px. Fix is padding-only CSS, no visual redesign.
**Files:** `styles.css` (+ `?v=` bump on 40 pages — one sed/grep pass). Effort S.
Risk: low (pure CSS; check:website-ui covers regressions).

**Decision:** [ ] YES   [ ] NO

---

## B. Design decisions (genuinely your call)

### W6. Official store badges instead of text buttons
Replace/augment the text buttons with Apple's "Download on the App Store" and
Google's "Get it on Google Play" badges — instantly recognizable, and both come
in es/ko localized versions. Constraint: badge artwork must be used unmodified
per Apple/Google brand rules. Suggested scope: hero + `/s` page; keep text
buttons elsewhere.
**Files:** new badge assets under `assets/`, `index.html`, `s/index.html`,
`styles.css`, `store-links.js` (localized badge swap). Effort M.

**Decision:** [ ] YES   [ ] NO

### W7. Full-width stacked CTA buttons on mobile
At 375px the hero buttons render centered at ~200px wide. Common mobile pattern
is full-width stacked buttons (easier to hit, cleaner stack). Pure style choice.
**Files:** `styles.css` + `?v=` bump. Effort S.

**Decision:** [ ] YES   [ ] NO

### W8. Store links in the footer
Footer currently has Privacy / Terms / Support. Adding "Get Twofer: iPhone ·
Android" puts an install path on every public page (incl. legal pages, which
rank well for brand searches).
**Files:** every page's footer block (or accept home-only), `localization.js` ×3. Effort S–M.

**Decision:** [ ] YES   [ ] NO

---

## C. Copy changes (must go through localization.js in en+es+ko)

### W9. Tell search engines and social shares the app is out
Current meta description / og:description / FAQ all pre-date the store launch:

- `home.meta` + og:description: "…Now live in Dallas-Fort Worth." → add "Free on
  iPhone and Android."
- FAQ "Where is Twofer available?" → mention the App Store and Google Play.
- Trust list "Free for customers." → "Free for customers on iPhone and Android."

Each is a small edit ×3 languages (`localization.js`) + the hardcoded English
og:/JSON-LD strings in `index.html` heads. Effort S–M. Note: og: tags are not
localized today (hardcoded English) — that stays as-is.

**Decision:** [ ] YES   [ ] NO

### W10. JSON-LD aggregateRating — parked, do not do now
Once the App Store listing has real ratings, `MobileApplication` JSON-LD can
carry `aggregateRating` for star-rating search results. Adding it before real
ratings exist is fabrication and against Google's rules. No action now; revisit
when ratings accumulate.

**Decision:** (none — informational)

---

## D. Hygiene

### W11. Add the i18n parity check as a repo script
During this review I wrote a checker that parses `localization.js` (base blocks +
`Object.assign` extensions), verifies en/es/ko key parity, and cross-references
every `data-i18n*` key used in HTML. It caught nothing today — which is exactly
what makes it a cheap permanent guard. Wire it as
`scripts/check-website-i18n.js` + `npm run check:website-i18n`, and it becomes a
one-line step in the post-edit checklist.
**Files:** new script + `package.json`. Effort S. Risk: none (read-only check).

**Decision:** [ ] YES   [ ] NO

### W12. Unreferenced assets ship with every deploy
`assets/twofer-logo.png` (362 KB), `photo-bakery-croissants.jpg` (85 KB),
`icon-48/192/512.png` are referenced by nothing. Zero user impact (never
downloaded) — only deploy tidiness. Honest recommendation: **skip** unless you
want the folder clean; if yes, they move to an `archive/` outside `website/`
(nothing gets deleted).

**Decision:** [ ] YES — archive them   [ ] NO — leave as is

### W13. Launch-signup email capture is now permanently dormant
With store links live, every "Email me launch updates" form is auto-hidden
forever, but the markup, `launch-signup.js`, and the Supabase endpoint stay
wired. Keeping it is zero-risk and it could serve a future new-city waitlist;
removing it trims dead code. Honest recommendation: **keep** (NO).

**Decision:** [ ] YES — remove it   [ ] NO — keep it

---

## E. Store-console items (not website — you do these in the consoles)

### W14. App Store seller name shows "Paul Sanders"
Customers see "Paul Sanders" under the app title; Play shows "TWOFER". A brand
seller name on the App Store generally requires an **organization** account (or
a registered DBA/trade name) — for individual accounts Apple displays the legal
name. Worth checking what App Store Connect offers your account before assuming
it's a quick edit. (I earlier said it was a simple display-name change — that
was too optimistic for an individual account; verify in ASC first.)

### W15. Category mismatch between stores
App Store: **Shopping**. Play: **Food & Drink**. Both stores offer both
categories — pick one identity. Play category changes apply on save; App Store
category changes take effect with the next version you submit.

---

*Validation for any approved item:* `npm run check:website-ui` always; W2/W6
also re-verify store hrefs on the live site post-deploy; any copy item (W8, W9)
requires all three languages in the same change. Deploy stays gated on your
explicit go, from `website/`, per `docs/website-edit-checklist.md`.
