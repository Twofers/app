# Website Spanish-reviewer feedback — verification + fix plan (2026-07-22)

> **PHASE 1 IMPLEMENTED 2026-07-22 — not committed, not deployed.** Dan approved
> Phase 1 (L1, L3, L4, L5, L6) including the proposed L1/L3 wording. Follow-on to
> `website-post-launch-improvement-plan-2026-07-22.md` (W-items). Deploy remains
> hard-gated; commit only when Dan asks.
>
> | Item | Status |
> |---|---|
> | L1 ES hero "hora feliz" | Done |
> | L2 localized app screenshots | **Phase 2 — not started** (needs S10 capture) |
> | L3 bait-and-switch ES + KO | Done |
> | L4 store-badge first-paint locale | Done, verified |
> | L5 Spanish diacritics (~370 strings) | Done, hand-proofread |
> | L6 i18n diacritics guard | Done, passing |
>
> Verification run: `check:website-i18n` passes (375 keys × 3 locales);
> `check:website-ui` passes (37 routes × 2 viewports); Spanish rendering,
> badge-locale, legal pages, signup form and 375px overflow checked in-browser.
> Files touched: `website/localization.js`, `website/store-links.js`,
> `scripts/check-website-i18n.js`, 22 HTML pages (`?v=` bump only), and this
> plan + `docs/website-edit-checklist.md`.

A native Spanish speaker reviewed twoferapp.com (homepage, Solicitar acceso
form, Terms, Privacy) and reported 5 issues. Every claim was verified against
the source before writing this plan. Verdicts:

| # | Reviewer claim | Verdict | Where |
|---|---|---|---|
| 1 | Hero punchline "happy hour" is English on the ES page | **Confirmed** | `website/localization.js:222` |
| 2 | Phone mockup screenshot is English-only | **Confirmed** — it is a raster image, not translatable text | `website/index.html:163` → `assets/app-home-feed.webp` |
| 3 | "bait-and-switch" survives in ES legal text | **Confirmed — also in KO** | `localization.js:952` (es), `:1136` (ko) |
| 4 | Store badges show in English | **Not reproducible in current code** — ES/KO badge art exists and is selected by locale; but there is a real first-paint ordering flaw on the homepage (details in L4) | `website/store-links.js:31-42`, `index.html:31` vs `:283` |
| 5 | Spanish is missing almost all accents, except the 404 page | **Confirmed, systemic** — only 25 lines in the whole 110 KB `localization.js` contain any accented character; the accented islands (a11y, 404, parts of trial/thanks) explain the 404 inconsistency | `localization.js` es blocks: `184-361`, `580-617`, `840-1023` |

Reassurance worth passing back to the reviewer: **the app itself is localized**
(EN/ES/KO are active targets; deals carry translations). The English screenshot
is a stale marketing asset, not evidence of an English-only product.

Korean side-note: the KO hero is fine — "해피아워" is the standard Hangul
loanword for happy hour. No KO action needed beyond L3/L5's leakage sweep.

---

## L1. ES hero: replace "happy hour" with "hora feliz"

`localization.js:222`:

```
"home.hero": "Convierte las horas lentas en tu <span>hora feliz.</span>",
```

Keeps the slow-hours → happy-hour wordplay fully in Spanish. ("Happy hour" is
widely understood in Mexican Spanish, but the punchline being English defeats
the tagline for exactly the audience the ES page targets.) EN (`:44`) and KO
(`:400`) unchanged. **Copy change → needs Dan's OK on the exact wording.**

## L2. Localized app screenshots for the hero phone mockup (asset work)

The mockup is `assets/app-home-feed.webp` (740×1334, ~66 KB) with English app
UI baked into the pixels ("Search deals or shops", tab labels, filter pills).
Its `alt` is already localized (`data-i18n-alt="a11y.appFeedShot"`); the pixels
are not.

Fix in three parts:

1. **Capture** ES and KO home-feed screenshots on the S10 (`/sh` skill): set
   device language to Español (México), relaunch app, home feed with at least
   one live deal visible; repeat for 한국어. Crop/scale to exactly the current
   asset's framing and export `app-home-feed-es.webp` / `app-home-feed-ko.webp`
   at 740×1334, similar quality/size. Emulator is the fallback if the S10 is
   unavailable.
2. **Mechanism**: add `data-i18n-src` support to `applyLocale()` in
   `localization.js` (mirrors the existing `data-i18n-alt` block):

   ```js
   document.querySelectorAll("[data-i18n-src]").forEach((node) => {
     const value = textFor(node.getAttribute("data-i18n-src") || "", nextLocale);
     if (value && node.getAttribute("src") !== value) node.setAttribute("src", value);
   });
   ```
3. **Wire-up**: keys ×3 locales (parity checker requires all three) —
   `"home.appFeedShotSrc"`: en `/assets/app-home-feed.webp`, es/ko the new
   files — plus `data-i18n-src="home.appFeedShotSrc"` on the img at
   `index.html:163`. Static `src` stays as the EN/no-JS fallback; `width`,
   `height`, `loading="eager"` unchanged.

Optional sibling (**Phase 3, Dan's call**): the business-band poster shot
`assets/app-ai-poster.webp` (`index.html:222`) is also English. A Spanish
poster means generating one in AI Studio (or reusing an existing ES QA
artifact) — defensible to skip since poster content is merchant-authored, but
the same `data-i18n-src` mechanism would carry it for free once captured.

## L3. Translate "bait-and-switch" in ES + KO legal text

Translation-only clarification; the EN original (canonical, hardcoded in
`business-terms/index.html:72` and `localization.js:768`) is unchanged. **These
are the Terms users consent to → list for Dan's explicit OK:**

- ES `localization.js:952`: "…u ofertas enganosas de bait-and-switch." →
  "…u ofertas engañosas de tipo señuelo (bait-and-switch)."
  (Spanish gloss carries the meaning; the parenthetical keeps traceability to
  the EN original. Alternative: drop the parenthetical entirely.)
- KO `localization.js:1136`: "오해를 유도하는 bait-and-switch 오퍼" →
  "오해를 유도하는 미끼 상술(bait-and-switch) 오퍼"

Same pass: sweep ES and KO blocks for any other untranslated idiom (grep Latin
tokens in KO blocks; known ES anglicisms to judge case-by-case: "checkout
movil" → "pago móvil", "ola de onboarding" → "una etapa de incorporación
posterior". Product nouns stay: cold brew, Twofer, QR, Stripe, Apple Pay).

## L4. Store badges: make first paint locale-correct

What the code does today: `store-links.js` has correct ES/KO badge art
(`assets/badge-appstore-es.svg`, `badge-googleplay-es.png`, ko variants) and
selects by locale, re-rendering on `twofer:localechange`. So a stable
English-badges-on-ES-page state should not exist in the current deploy. Two
explanations for the report:

- **Real ordering flaw (fix this)**: on the homepage, `store-links.js` loads in
  `<head>` (`index.html:31`) and its DOMContentLoaded handler runs before
  `localization.js` (body-end, `:283`) applies the locale — so badges render
  **EN first** off the static `lang="en"`, then swap when the localechange
  event fires. A reviewer eyeballing or screenshotting catches EN; if the swap
  ever fails, EN sticks.
- Deploy-churn window: the reviewer may also have visited during today's
  cache-param incident (see checklist §3 note).

Fix: resolve locale inside `store-links.js` the same way `localization.js`
does, instead of trusting `documentElement.lang` timing —
`localStorage.twofer_site_locale` → `navigator.languages[0]` →
`documentElement.lang` fallback. (`applyLocale` writes localStorage *before*
dispatching the event, so the re-render path stays consistent too.) Keep the
existing localechange listener. Result: correct badge language on first paint
on all three badge pages (`/`, `/s`, checkout — `/s` and checkout load
localization first and are already safe, but gain no-flash robustness).

Post-deploy: verify on live with a fresh es-MX browser profile (hard refresh)
that the **first** paint shows Spanish badges.

## L5. Restore Spanish diacritics across localization.js (the big one)

Scope: es base block `184-361` plus `Object.assign` extensions `580-617` and
`840-1023` — roughly **370 strings**, the majority missing á/é/í/ó/ú/ñ/ü/¿/¡
("Como funciona", "Terminos", "Direccion", "Configuracion", "eliminacion",
"companias", "dias habiles", "ingles, espanol"…). Hand-proofread every ES
string — **no scripted find-replace** ("esta/está"-class words need a human
reading). Includes:

- Inverted punctuation: "Necesitas cambiar algo…?" → "¿Necesitas…?"
- "Menu" → "Menú" (`:188`)
- **Duplicate-key bug**: `thanks.note` is defined twice — accented at `:615`,
  unaccented at `:971`; the later assign block wins, so the *bad* copy renders
  today. Fix both (or dedupe) — and check for other duplicate keys across the
  assign blocks while in there.
- No copy rewrites beyond spelling/idioms — Dan's keep-copy-minimal rule.

The accented islands (a11y block, notFound, parts of trial/thanks) are already
correct — leave them.

## L6. Regression guard so this never ships again (recommended)

Extend `scripts/check-website-i18n.js` (it already isolates each locale's
text via `braceSpan`) with a conservative denylist of **unambiguously**
misspelled accent-less tokens in the es blocks — word-boundary, case-
insensitive: `terminos, politica(s), articulo(s), configuracion, informacion,
direccion, telefono, eliminacion, facturacion, promocion, tambien, aqui,
dia(s), habiles, ingles, espanol, companias, codigo, numero, ubicacion, sesion,
valido(s/a/as), movil, demas`. Excludes ambiguous words (esta, mas, se…).
Fails the check with file/line so the existing `check:website-i18n` step in the
edit checklist catches any future regression. ~30 lines.

---

## Phasing

- **Phase 1 — text + code, one session (L1, L3, L4, L5, L6):** no device or
  asset dependencies; shippable as a single deploy once Dan approves L1/L3
  wording.
- **Phase 2 — screenshots (L2):** needs the S10 (or emulator) and app-language
  flips; separate capture-and-deploy, or folded into Phase 1 if captured first.
- **Phase 3 — optional (Dan decides):** ES/KO poster shot for the business
  band.

## Validation + deploy (maps to docs/website-edit-checklist.md)

1. `npm run check:website-i18n` (parity + new L6 guard) and
   `npm run check:website-ui` — both green.
2. **Cache-bust (§3):** every edited versioned file gets a new `?v=`
   (`20260722-es-polish` or the implementation date) on **all** including
   pages: `localization.js` = 22 pages, `store-links.js` = 3 pages. Verify
   with the checklist grep — one version per file, and it's the new one.
3. Local visual pass (§7) at 1366 + 390: toggle EN→ES→KO on `/`,
   `/business/start-trial`, `/terms`, `/privacy`, `/business-terms`, 404; no
   raw keys, console clean; badge language flips with the toggle; (Phase 2)
   mockup image swaps per locale.
4. Store-CTA invariants (§6) since store-links.js changes: both store URLs
   real, badge anchors resolve, `apple-itunes-app` meta intact, JSON-LD parses.
5. Sitemap `<lastmod>` for meaningfully changed pages (`/`, `/terms`,
   `/privacy`, `/business-terms`).
6. **Deploy = hard gate.** On Dan's go: `cd website && npx vercel deploy
   --prod --yes` (from `website/`, worktree-deploy rule), then §9 live
   verification hard-refreshed, plus the L4 es-MX first-paint badge check.
7. Commit only when Dan asks; never push.

## Out of scope

No app code, no edge functions, no locked AI-poster files, no EN legal wording
changes. Website files + `scripts/check-website-i18n.js` only.

## Decisions Dan needs to make

1. L1 wording: "…en tu hora feliz." — OK?
2. L3 legal translations (ES + KO strings above) — OK to ship? Keep or drop
   the "(bait-and-switch)" parenthetical?
3. Phase 2 capture plan (S10, device-language flips) — approve when ready.
4. Phase 3 poster shot — do it or skip?
