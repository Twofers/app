# Website edit checklist

Run this after **every** change under `website/`, before and after deploying.
Steps marked (always) apply to any edit; the rest are conditional — skip what
doesn't match the change. Commands run from the repo root unless noted.

---

## 1. Scope guard (always)

- [ ] `git status` shows **only** the files you meant to touch. Nothing else
      swept in, no generated/QA artifacts staged.
- [ ] `git diff` read top to bottom — every hunk is intentional.

## 2. Automated checks (always)

- [ ] `npm run check:website-ui` passes.
      Covers, per route × desktop (1366) + mobile (390): console/page errors,
      broken images, horizontal/text overflow, empty pages, EN→ES→KO language
      switch, mobile menu, admin flows with mocked endpoints, 404 handling.
- [ ] If the change touched a Supabase endpoint URL, form action, or runtime
      config: `npm run check:website-supabase`.

## 3. Cache-bust check (if you edited any versioned file)

Shared files are included with `?v=` params. **Editing the file without bumping
`?v=` on every including page ships a change returning visitors won't see.**

Current inventory (re-count with the grep below if in doubt):

| File | Included by |
|---|---|
| `styles.css` | 40 pages |
| `localization.js` | 22 pages |
| `store-links.js` | 3 pages (`/`, `/s`, `/business/billing/checkout`) |
| `launch-signup.js` | 1 page (`/`) |

- [ ] Edited one of these? Bump its `?v=` to `YYYYMMDD-shortslug` on **all**
      including pages:

```bash
grep -rn "store-links.js?v=" website --include=*.html
```

(swap the filename; every hit must show the new version)

## 4. Copy / localization (if any user-visible text changed)

- [ ] The change is in `localization.js` for **en, es, and ko** — never
      English-only, never hardcoded in HTML (hardcoded `og:`/JSON-LD head
      strings are the one sanctioned exception).
- [ ] On the affected page, toggle EN → ES → KO: text switches, no raw key
      names visible, console clean.
- [ ] i18n parity check passes (if `npm run check:website-i18n` exists — see
      plan item W11; until then, eyeball that each key appears 3× in
      `localization.js`).

## 5. New page (if you added a route)

- [ ] `vercel.json`: rewrite entries for both `/path` and `/path/`.
- [ ] Head is complete: `<title>`, meta description, canonical, favicon links,
      `theme-color`, `og:` tags — or `noindex` (meta **and** `X-Robots-Tag`
      header in `vercel.json`) if it's not a public page.
- [ ] All copy via `localization.js` ×3; page includes `localization.js?v=`.
- [ ] Public + indexable → added to `sitemap.xml`.
- [ ] Added to `ROUTES` in `scripts/check-website-ui-crawl.js` so it's covered
      by every future run of this checklist.

## 6. Store CTA invariants (if you touched store-links.js, any CTA, or head metas)

- [ ] `TWOFER_STORE_LINKS.ios` and `.android` are both real URLs (a `null`
      silently hides that platform's buttons site-wide — this exact failure
      hid the iPhone buttons after the iOS launch).
- [ ] All `data-store-cta` anchors on `/`, `/s`, and checkout resolve to the
      correct store URL.
- [ ] `apple-itunes-app` meta still present on `/` and `/s`.
- [ ] JSON-LD blocks on `/` still parse (paste into the browser console:
      `[...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>JSON.parse(s.textContent)['@type'])`).

## 7. Local visual pass (always)

Serve the site (uses `.claude/launch.json` → `twofer-website`, or):

```bash
python -m http.server 4180 --directory website
```

- [ ] Changed pages at desktop width: render correct, console clean.
- [ ] Changed pages at 375px: no horizontal scroll, buttons reachable, menu
      button opens the nav.
- [ ] Links you added actually navigate (click them).

## 8. Deploy (gated — Dan says go)

Deploying is a hard gate. When approved:

```bash
cd website
npx vercel deploy --prod --yes
```

- [ ] Run **from `website/`** — that's where `.vercel/project.json` lives, and
      deploys ship the directory you run them from (worktree-deploy rule).
- [ ] Output shows `"readyState": "READY"` and `"target": "production"`.

## 9. Post-deploy live verification (always after a deploy)

On `https://www.twoferapp.com` (hard refresh — Ctrl+Shift+R; the site sits
behind Cloudflare + Vercel caching):

- [ ] Changed pages render the new content; view-source shows the new `?v=`.
- [ ] Console clean on changed pages.
- [ ] Store buttons visible with correct hrefs (spot-check one iPhone + one
      Android button).
- [ ] Quick infra sweep still green — paste in the browser console on any
      twoferapp.com page:

```
for (const p of ['/sitemap.xml','/robots.txt','/.well-known/apple-app-site-association','/.well-known/assetlinks.json']) fetch(p,{cache:'no-store'}).then(r=>console.log(p, r.status, r.headers.get('content-type')));
```

Expect four 200s; the two `.well-known` files must be `application/json`.

- [ ] If share flow was touched: open `/s/AAAAAAA` (invalid code) → shows
      "This link isn't available", not an error.

## 10. Record (always)

- [ ] Content meaningfully changed on a sitemap page → update its `<lastmod>`.
- [ ] Commit **only when Dan asks**; never push without explicit approval.
- [ ] If the change altered how future edits should be made (new versioned
      file, new invariant), update **this checklist** in the same change.
