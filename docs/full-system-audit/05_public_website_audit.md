# Public website audit

## Live safe checks

The homepage, business start page, privacy page, `/admin`, and a synthetic share route loaded without console errors. No form was submitted. The privacy page visibly describes ephemeral AI voice processing.

## F-008 — Business onboarding mobile gate failures (P2)

`npm run check:website-supabase` failed two assertions: obsolete DFW request copy and a missing `trial-jump` class. `npm run check:website-ui` failed two mobile assertions: no form jump and form top reported at 1,582 px. The link is at `website/business/start-trial/index.html:76`, the form begins at `:114`, and `.trial-jump` CSS exists at `website/styles.css:898`.

This mixes a real mobile conversion/accessibility problem with stale release assertions. Approve current copy, provide an explicit accessible jump, correct the mobile journey, and update the checker contract.

## F-009 — Share page is generic (P2)

`website/s/index.html` never resolves its code. A safe live GET of `/s/ABCDEFG` displayed no offer/business preview and no invalid/expired distinction. The hardened `lookup_deal_share` SQL already exists, but the page does not consume it.

## F-010 — Store URLs are null (P2)

`website/store-links.js:3-5` has no App Store or Play destination, so the public site cannot convert visitors into installs.

## Remaining web gaps

All routes/viewports, forms, redirects, 404s, consent/error states, no-JS behavior, accessibility, SEO, structured data, cookie/storage behavior, rate limiting, and load/performance were not exhaustively verified. The historical separate website checkout was absent; `website/` is the current tracked source.

