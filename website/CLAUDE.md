# Website (`website/`) — agent conventions

Scope: the marketing + business/admin site served at twoferapp.com. This is a
**static, hand-written HTML/CSS/JS site — no framework, no build step, no
bundler.** Files are served as-is. The git root (`../`) has its own CLAUDE.md
for the mobile app; this file governs `website/` only.

Before editing, read `docs/website-edit-checklist.md` (run from repo root) — it
is the source of truth for the full edit→check→deploy loop. This file is the
orientation; the checklist is the procedure.

## Pages / routing

Folder-based: each route is an `index.html`, mapped by `vercel.json` rewrites.
- Public: `/`, `/404`, `/s` (share landing), `/support`, `/privacy`, `/terms`,
  `/business-terms`, `/delete-account`, `/quick-approve-trial`
- Business: `/business`, `/business/start-trial`, `/business/claim`,
  `/business/thanks`, `/business/waitlist`, `/business/review-pending`,
  `/business/billing/{start,status,success,cancel,checkout,manage,add-payment-method}`
- Admin: `/admin` and sub-pages (login, businesses, prospects, trial-requests,
  qr-campaigns, offers, reports, billing/events, audit-log, settings, ai-*).
  Admin pages must stay non-indexable.

New route → add BOTH `/path` and `/path/` rewrites in `vercel.json`, register it
in `scripts/check-website-ui-crawl.js` ROUTES, and (if public) add to sitemap.xml.

## Localization (en / es / ko)

Engine: `localization.js` (single IIFE, no deps). At load it resolves a locale,
then swaps DOM text/attributes by looking up keys in one `messages` object.

- Locale resolution: `localStorage["twofer_site_locale"]` if es/ko/en, else the
  browser language normalized (`es*`→es, `ko*`→ko, else `en`).
- Lookup `textFor` = `messages[locale][key] || messages.en[key] || ""`. Fallback
  is SILENT: a missing es/ko key renders English; a key missing from every
  locale returns "" and the setters keep the hardcoded HTML fallback. Bad keys
  never show as raw text at runtime — only the check script catches them.
- Attributes handled (use these, nothing else): `data-i18n` (textContent),
  `data-i18n-html` (innerHTML), `data-i18n-content` (meta content),
  `data-i18n-placeholder`, `data-i18n-alt`, `data-i18n-src` (localized image),
  `data-i18n-aria-label`.

Where strings live: ALL in `localization.js`, under `messages`. Each locale is a
base block (`en: {`, `es: {`, `ko: {`) PLUS `Object.assign(messages.<locale>,
{…})` extension blocks lower down. Anything that parses keys must read both
forms. `store-links.js` carries its own separate copy of store-button strings.

### The i18n rule (hard)

**Every `data-i18n`/`data-i18n-*` key must exist in all three languages —
en, es, AND ko.** Never English-only, never hardcoded in HTML. The one
sanctioned exception is `<head>` `og:`/JSON-LD strings, which stay hardcoded.
Enforced by `npm run check:website-i18n` (key parity across en/es/ko, every
markup key resolves, ES diacritics denylist). It must pass before deploy.

Spanish accents: the ES guard is a denylist, not a spellchecker. Passing is not
proof the copy is accented — ambiguous words ("mas", "esta", "publica", plurals)
need a human read. NEVER fix accents with a scripted find-replace.

## Cache-busting (`?v=`) — manual, easy to get wrong

Shared files are included as `/file.ext?v=YYYYMMDD-shortslug`. There is no
automation. **Editing a shared file without bumping `?v=` on EVERY including page
ships a change returning visitors never see** (this broke store badges on
2026-07-22). Current includers: `styles.css` (40 pages), `localization.js` (22),
`store-links.js` (5: `/`, `/s`, `/support`, `/business/thanks`,
`/business/billing/checkout`), `launch-signup.js` (1: `/`).

After editing any of them, bump `?v=` on all including pages, then verify each
file shows a single version:
    grep -rhoE '(href|src)="/[a-z-]+\.(css|js)\?v=[^"]+"' website --include=*.html | sort | uniq -c

## Other fragile spots

- Two independent locale resolvers (`localization.js`, `store-links.js`) must
  agree on `STORAGE_KEY` and normalize order; `store-links.js` loads in `<head>`
  so it can briefly flash EN badges before the swap.
- `null` in `TWOFER_STORE_LINKS` hides that platform's buttons site-wide.
- Duplicate i18n keys (base + Object.assign): last wins, earlier copy is dead.

## Checks & deploy

- `npm run check:website-i18n` · `check:website-ui` · `check:website-supabase`
  (all from repo root). Preview: `python -m http.server 4173 --directory website`.
- Deploy is a HARD GATE — only when Dan says go. Run from `website/`:
  `npx vercel deploy --prod --yes`. Commit only when asked; never push unasked.
