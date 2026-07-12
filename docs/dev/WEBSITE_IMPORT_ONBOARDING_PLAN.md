# Website Import at Business Onboarding — Implementation Plan

Status: PLANNED (approved by Dan for planning 2026-07-08; implementation approval per work item below)
Owner: agent (Opus) following this plan; Dan approves all gated steps.
Goal: a new business owner can create an account and publish their first AI deal in under 5 minutes. The accelerator: after the Google Places lookup autofills their profile, we fetch their own website server-side and prefill their **logo** and **menu items** for one-tap confirmation.

---

## 0. Read this first — how to not break things

1. **Read `CLAUDE.md` at the repo root before starting.** All of its hard gates apply. In particular you may WRITE migration files and edge-function code, but you may NOT apply migrations, deploy edge functions (to prod OR dev — both are hosted projects), change `eas.json` build behavior, or build the app without Dan's explicit approval.
2. **Locked files you must NOT edit** (see `docs/ai-poster-core-lock.json` for the full list). The ones you will be tempted to touch:
   - `lib/functions.ts` — LOCKED. Do NOT add the new client wrapper here. Put it in a new file `lib/business-site-import.ts` (precedent: `lib/business-lookup.ts` is its own module; `lib/functions.ts:405` merely re-exports it. Do not add a re-export — new call sites import from the new module directly).
   - `app/create/ai.tsx`, `supabase/functions/ai-generate-ad-variants/*`, `_shared/ai-image-provider.ts`, poster files — LOCKED. This is why site **photos** are Phase 2 (section 12), not v1.
   - Do not modify `supabase/functions/ai-extract-menu/index.ts` or `app/create/menu-scan.tsx`. Reuse their *patterns*, not their code paths.
3. **Everything ships dark behind a flag.** The UI is gated on `EXPO_PUBLIC_ENABLE_SITE_IMPORT === "true"` (same pattern as `EXPO_PUBLIC_ENABLE_SHARE_DEAL` in `lib/runtime-env.ts:205`). Default off. Existing builds and flows are untouched when the flag is unset.
4. **The edge function is read-only.** It fetches and extracts; it never writes to the database or storage (except the rate-limit event row and AI cost ledger rows). All persistence happens client-side through existing RLS-covered paths. This keeps blast radius near zero.
5. Work the items in order (WI-1 → WI-7). Each has its own validation. Stop at every 🔒 gate.
6. This is a Windows machine. There is no local Supabase and you must not start one (no `supabase start`, no Docker). Edge-function correctness is proven by unit tests on pure helpers + typecheck; live verification happens only after Dan approves a deploy.

---

## 1. Product flow being built

Current onboarding ([app/business-setup.tsx](../../app/business-setup.tsx), 938 lines, NOT locked):
type business name → `ai-business-lookup` (Google Places) autofills name/address/phone/hours/category **and website** (`applyLookupResult`, ~line 380) → owner optionally uploads logo manually → submit creates/updates the `businesses` row → logo uploads to the `business-logos` bucket (`uploadLogo`, line 316).

New (flag-gated) insert into that same screen:

1. After a Places result with a non-empty `website` is applied, show an **"Import from your website"** card.
2. Tap → call new edge function `import-business-website` (action `scan`) with the website URL → spinner ("Checking your website…", localized).
3. Response renders a review section:
   - **Logo candidates** (up to 4 thumbnails, server-fetched as data URIs). Tapping one selects it as the logo. Manual upload stays available and wins if used afterward.
   - **Menu items** (name / category / price, same shape the menu scanner produces). Each row has a remove ✕. Header copy states: *"Found on your website — remove anything that's wrong."*
   - A single confirm line above the import button: *"This is my business's website and I have the right to use this content."* The import button is disabled until a checkbox next to it is checked. This is the copyright consent gate — do not soften or remove it.
4. Nothing persists at review time. On the screen's existing submit:
   - Selected logo → written to a cache file → flows through the **existing** `logoUri` state and `uploadLogo()` path unchanged.
   - Kept menu items → one `insert` into `business_menu_items` with `source: 'import'` (mirrors [menu-scan.tsx:311-320](../../app/create/menu-scan.tsx)).
5. Downstream needs zero changes: `ai-deal-suggestions` and the menu-offer flow already read `business_menu_items`, so the first-deal AI suggestions are grounded in real menu data immediately.

Failure is always soft: site unreachable / nothing found / feature errors → card shows a one-line localized notice and the owner continues exactly as today (manual logo, menu photo scan later). Import must never block onboarding.

Out of scope for v1 (see §12): importing food/interior photos, Facebook/Instagram sources, JS-only sites needing a rendering service, Google Places photos (Google ToS forbids storing them — never do this in any phase).

---

## 2. Existing building blocks (verified in code — reuse, don't reinvent)

| Piece | Where | What you reuse |
|---|---|---|
| Places lookup incl. website URL | `supabase/functions/ai-business-lookup/index.ts`; applied in `app/business-setup.tsx` `applyLookupResult` | The website URL input to scan |
| Menu extraction schema + normalization | `supabase/functions/ai-extract-menu/index.ts` (`menuSchema` lines 384-414, `normalizeMenuItems` lines 69-86, instruction style lines 369-382) | Copy the schema/normalizer shapes into the new `_shared/site-import.ts`; keep field names identical |
| Provider router (Gemini-first, OpenAI fallback, cost-logged) | `supabase/functions/_shared/ai-text-provider.ts` → `generateStructuredText`, `resolveAiTextProviderConfig`; usage example `ai-extract-menu/index.ts:427-450` | The one AI call in this feature |
| Cost ledger | `_shared/ai-costs.ts` → `logAiCost` (writes `ai_generation_costs`); per-attempt logging pattern `ai-extract-menu/index.ts:98-121` | New `feature: "site_import"` (feature is free text; it will appear in the admin AI Cost by Feature report automatically) |
| Auth/CORS/role guards | `_shared/cors.ts` `getCorsHeaders`; `_shared/redemption-role.ts` `isRedeemerUser` / `forbiddenForRedeemerResponse` | Same header + guard block as `ai-business-lookup` |
| Menu storage | `business_menu_items` table (`supabase/migrations/20260429120000_business_menu_items.sql`) + `size_options TEXT[]` (`20260707120000`); owner-only RLS already in place | Client insert, payload identical to `menu-scan.tsx:311-320` but `source: 'import'` |
| Logo storage | `business-logos` bucket via `uploadLogo()` in `business-setup.tsx:316-332` | Unchanged — feed it a `file://` URI |
| Feature-flag pattern | `lib/runtime-env.ts:205` (`EXPO_PUBLIC_ENABLE_SHARE_DEAL`) | Clone for `EXPO_PUBLIC_ENABLE_SITE_IMPORT` |
| Client-wrapper + test pattern | `lib/business-lookup.ts`, `lib/functions.business-lookup.test.ts` | Template for `lib/business-site-import.ts` + test |
| Localization | `lib/i18n/locales/en.json`, `es.json`, `ko.json` | All new copy (`businessSetup.import*` keys) in all three |
| Test runner | `vitest` (`npm test`); `_shared` TS files are directly testable (see `_shared/ai-image-provider.test.ts`) | Unit tests for all pure helpers |

---

## 3. WI-1 — Migration: `source='import'` + rate-limit table

New file `supabase/migrations/<timestamp>_site_import_foundation.sql`:

```sql
-- 1) Allow 'import' as a menu-item source (website import at onboarding).
ALTER TABLE public.business_menu_items
  DROP CONSTRAINT IF EXISTS business_menu_items_source_check;
ALTER TABLE public.business_menu_items
  ADD CONSTRAINT business_menu_items_source_check
  CHECK (source IN ('scan', 'manual', 'import'));

-- 2) Per-user scan-event log for rate limiting (service-role only).
CREATE TABLE IF NOT EXISTS public.site_import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  website_host TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_site_import_events_user_time
  ON public.site_import_events (user_id, created_at DESC);
ALTER TABLE public.site_import_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_import_events FROM anon, authenticated;
```

Notes:
- `business_menu_items_source_check` is the default Postgres name for the inline check in the original migration; `DROP CONSTRAINT IF EXISTS` makes this safe either way. If it doesn't exist under that name, find it with a `DO $$` lookup over `pg_constraint` rather than guessing a second name.
- RLS enabled with **no policies** + revoked grants = only service role touches it. This table stores no content, only counts.
- Store only the hostname, never full URLs (may contain tokens/paths).

🔒 GATE: Dan applies this migration (`supabase db push` is hard-gated). It does not touch existing RLS policies, but run `node scripts/probe-rls-smoke.mjs` after apply anyway — cheap insurance and house habit.

Ordering guarantee: the app writes `source:'import'` only when the flag is on, and the flag only turns on after the migration is applied (§11). No compatibility window exists where the app can hit the old CHECK.

---

## 4. WI-2 — Pure helpers: `supabase/functions/_shared/site-import.ts` (+ `.test.ts`)

Everything testable lives here as pure functions with no I/O, so vitest covers the risky logic without a live function. Required exports:

### 4.1 `validateImportUrl(raw: string): { ok: true; url: URL } | { ok: false; code: string }`
- `https:` only. Reject `http:`, anything else, credentials in URL (`url.username || url.password`), non-default ports (allow only 443), length > 2048.
- Reject hostname that is an IP literal (v4 or v6) or `localhost` / `*.local` / `*.internal`.
- This is syntax-level only; the DNS/IP check happens in the fetch wrapper (§5.2) because it's async.

### 4.2 `isPrivateOrReservedIp(ip: string): boolean`
Must return true for: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (link-local/metadata), `0.0.0.0/8`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, multicast/reserved `224.0.0.0/3`, and for IPv6: `::1`, `::`, `fc00::/7`, `fe80::/10`, `::ffff:0:0/96` mapped-IPv4 (recurse into the mapped v4). Table-driven tests for every range, both sides of each boundary.

### 4.3 `extractLogoCandidates(html: string, baseUrl: string): Array<{ url: string; source: "og_image" | "apple_touch_icon" | "link_icon" | "json_ld_logo" | "header_img" }>`
- Parse with regex/string scanning over the raw HTML (no DOM dependency — keeps the function Deno/Node portable and vitest-testable). Extract in priority order:
  1. JSON-LD `<script type="application/ld+json">` blocks → `logo` / `image` of `Organization`/`LocalBusiness`/`Restaurant` nodes (parse JSON defensively; ignore parse failures).
  2. `<meta property="og:image" content=...>` (also `og:image:secure_url`).
  3. `<link rel="apple-touch-icon" ...>` (largest `sizes` first).
  4. `<link rel="icon">` / `rel="shortcut icon"` — skip `.ico` (RN can't render it); keep png/svg→png-able? No: keep only png/jpg/webp extensions or unknown (content-type is re-checked at fetch).
  5. First `<img>` inside/near `<header>`/`<nav>` whose `src|alt|class` matches `/logo/i`.
- Resolve relative URLs against `baseUrl` (`new URL(src, baseUrl)`), drop any that fail `validateImportUrl` (https-only etc.), dedupe, cap at 6 (server fetches at most 4 successfully).

### 4.4 `extractMenuLinks(html: string, baseUrl: string): Array<{ url: string; kind: "page" | "pdf" }>`
- Anchor tags whose href or inner text matches `/(menu|menú|carta|메뉴)/i`, plus any `href` ending `.pdf` whose text/path also matches the menu pattern (a bare "download our catering PDF" shouldn't win over `/menu`).
- Prefer same-host links; resolve relative; drop cross-host except known menu hosts? No — v1: same-host only (third-party ordering pages like Toast/Square are JS-only anyway). Cap at 3, `page` before `pdf`.

### 4.5 `htmlToMenuText(html: string): string`
- Strip `<script>`, `<style>`, `<noscript>`, comments, tags; decode basic entities; collapse whitespace; cap at 20,000 chars. This is the text handed to the LLM.

### 4.6 `buildSiteMenuPrompt(businessCategory: string): string`
- Mirror the rules of `ai-extract-menu/index.ts:369-382`, reworded for *website text* instead of an image: only items literally present in the text, never invent, `readable` is `true` for every emitted item (text is by definition legible — keep the field so the schema and normalizer stay identical), `price_text` exactly as printed, `size_options` from printed variants, `low_legibility` repurposed as "text looked like it wasn't a menu" → keep items minimal. Snapshot-test the prompt string (CLAUDE.md: every prompt requires fixture + regression coverage).

### 4.7 `normalizeMenuItems(...)` and `menuSchema`
- Copy the exact schema object (`ai-extract-menu/index.ts:384-414`) and normalizer (`:69-86`) into this module (small, stable shapes; duplication is deliberate to avoid touching the locked-adjacent scanner).

Also export shared caps as constants: `MAX_HTML_BYTES = 2_000_000`, `MAX_IMAGE_BYTES = 512_000`, `MAX_PDF_BYTES = 5_000_000`, `FETCH_TIMEOUT_MS = 10_000`, `MAX_REDIRECTS = 3`, `MAX_LOGO_CANDIDATES = 4`, `DAILY_SCAN_LIMIT_DEFAULT = 10`.

Tests (`_shared/site-import.test.ts`, vitest): fixture HTML strings covering — Squarespace-ish page with og:image + JSON-LD, Wix-ish page, page with only favicon.ico (→ excluded), relative URLs, `http:` logo link (→ dropped), menu link variants (`/menu`, "Our Menu", `menu.pdf`, Spanish `carta`, Korean `메뉴`), cross-host menu link (→ dropped), all IP-range boundaries, entity-decoding and 20k cap in `htmlToMenuText`, prompt snapshot.

Validation: `npm test -- site-import` green, `npm run typecheck:functions` green.

---

## 5. WI-3 — Edge function: `supabase/functions/import-business-website/index.ts`

One action (`scan`), read-only, modeled structurally on `ai-business-lookup/index.ts`. Add `deno.json` matching a sibling function's.

### 5.1 Request / response contract

Request (POST, authed):
```json
{ "website_url": "https://example.com", "business_id": "<uuid, optional>" }
```
Response 200:
```json
{
  "ok": true,
  "logo_candidates": [ { "data_uri": "data:image/png;base64,...", "source": "og_image", "content_type": "image/png", "bytes": 48211 } ],
  "menu": { "items": [ { "name": "...", "category": "...", "price_text": "...", "size_options": [], "readable": true } ], "low_legibility": false, "menu_notes": "" } ,
  "menu_page_url": "https://example.com/menu",
  "menu_pdf_url": null,
  "site_title": "…",
  "warnings": ["MENU_NOT_FOUND"]
}
```
`menu` may be `null` (with a warning code) — the client copes. Error responses follow the house shape `{ error, error_code }` with codes: `UNAUTHORIZED`, `INVALID_URL`, `BLOCKED_URL` (SSRF checks), `RATE_LIMITED`, `FETCH_FAILED`, `SITE_TOO_LARGE`, `AI_GENERATION_FAILED`, `SERVER`. Never echo upstream response bodies (CLAUDE.md rule).

### 5.2 Handler sequence

1. CORS/OPTIONS/method guards; auth via `supabase.auth.getUser()`; `isRedeemerUser` → 403. If `business_id` present, verify ownership exactly like `ai-extract-menu/index.ts:226-237`.
2. **Rate limit**: service-role count of `site_import_events` where `user_id = user.id AND created_at > now() - interval '24 hours'`; limit `SITE_IMPORT_DAILY_LIMIT` env (default 10). Over → 429 `RATE_LIMITED`. Then insert the event row (hostname only). Count-then-insert has a benign race; acceptable for this limiter.
3. `validateImportUrl` → 400 on failure.
4. **`safeFetch` wrapper** — the security core; every outbound request in this function goes through it:
   - `Deno.resolveDns(host, "A")` and `"AAAA"` (each in try/catch — missing AAAA is fine); if **any** resolved address hits `isPrivateOrReservedIp` → `BLOCKED_URL`. If both lookups fail → `FETCH_FAILED`.
   - `fetch(url, { redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": "TwoferBot/1.0 (+https://www.twoferapp.com)", "Accept": <per call> } })`.
   - On 301/302/303/307/308: re-run the **entire** validation (URL syntax + DNS/IP) on the `Location` target; max 3 hops.
   - Enforce content-type allowlist per call site (html: `text/html`; image: `image/png|jpeg|webp|gif|svg` — drop `svg` for logo candidates, RN `<Image>` won't render raw SVG; pdf: `application/pdf`).
   - Stream the body with a byte cap (reader loop; abort past cap → `SITE_TOO_LARGE` for the homepage, silently skip for individual images).
   - DNS re-resolution vs. connect (TOCTOU) is a known residual risk; acceptable here given auth + rate limit + this being a fetch-only function with no internal services reachable in Supabase's network beyond the metadata ranges already blocked.
5. Fetch homepage → `extractLogoCandidates` → `safeFetch` up to 6 candidates, keep the first `MAX_LOGO_CANDIDATES` that succeed under `MAX_IMAGE_BYTES` with an image content-type → base64 data URIs.
6. `extractMenuLinks` → try in order:
   - `kind: "page"` → fetch HTML → `htmlToMenuText` → if < 100 chars of text, treat as JS-only page and continue to next link.
   - Also scan the homepage itself for menu-looking text if no dedicated link is found (many single-page sites) — reuse `htmlToMenuText(homepage)` and let the model return few/no items.
   - `kind: "pdf"` → **only if** `GEMINI_API_KEY` is set AND you have verified (by reading `_shared/ai-text-provider.ts`) that the Gemini path passes `imageInputs[].mimeType` through verbatim and that you can pin the attempt to Gemini (e.g. config with `fallbackEnabled: false`), attempt extraction with `imageInputs: [{ bytes: pdfBytes, mimeType: "application/pdf" }]` in a try/catch. If that verification fails or the call throws, do NOT try the OpenAI path with a PDF; set `menu_pdf_url` in the response and move on. (The app then says "We found your menu PDF — snap a photo of your menu instead.")
7. The AI call (menu structuring only — logos are fully deterministic and free):
   ```ts
   generateStructuredText({
     operation: "merchant_context",
     systemPrompt: "Extract menu items from a local business's website text. Return only grounded JSON.",
     userPrompt: buildSiteMenuPrompt(bizCategory) + "\n\nWEBSITE TEXT:\n" + menuText,
     jsonSchema: menuSchema, maxOutputTokens: 1600, timeoutMs: 20_000,
     generationRunId: requestGroupId, promptVersion: "AI_SITE_MENU_IMPORT_V1", reasoningLevel: "low",
   }, { openAiApiKey, geminiApiKey, admin, config: /* same shape as menuExtractionConfig() in ai-extract-menu */ })
   ```
   Log every attempt via `logAiCost` with `feature: "site_import"` (success and failure paths, mirroring `logMenuProviderAttempts`).
8. Menu failure (throw, refusal, zero items) is a **warning**, never a request failure: return `menu: null` + warning code alongside whatever logos succeeded.
9. Structured logs throughout: `console.log(JSON.stringify({ tag: "site_import", event, ... }))` — hostnames and counts only, no full URLs with paths, no HTML, no secrets.

Time budget: homepage 2-4 s + logos in parallel 1-2 s + menu page 1-2 s + LLM 5-15 s ≈ 10-20 s worst case. Client spinner copy must set expectation ("This can take ~20 seconds").

Validation: `npm run typecheck:functions`; helper tests from WI-2 cover the logic; the handler itself stays a thin shell (fetch orchestration + guards) precisely so untested surface is minimal.

🔒 GATE: deploying this function anywhere (dev or prod project) requires Dan's approval.

---

## 6. WI-4 — Client wrapper: `lib/business-site-import.ts` (+ test)

- `export type SiteImportResult = { … }` mirroring §5.1; `export async function importBusinessWebsite(params: { website_url: string; business_id?: string }): Promise<SiteImportResult>` using `supabase.functions.invoke("import-business-website", { body: params })`, error shaping copied from `lib/business-lookup.ts` (map `error_code` → user-facing localized message keys via the existing `lib/i18n/function-errors.ts` pattern if it fits; otherwise a local map).
- Defensive parsing: unknown/missing fields → empty arrays/null, never throw on shape drift (same discipline as `business-lookup.ts`).
- Test file `lib/business-site-import.test.ts` modeled on `lib/functions.business-lookup.test.ts`: happy path, menu:null path, each error code, malformed payload.
- **Do not touch `lib/functions.ts`** (locked).

---

## 7. WI-5 — UI in `app/business-setup.tsx`

Keep the diff surgical; this screen already handles create + edit + onboarding-context modes and the submit paths at ~484-530.

1. Flag helper in `lib/runtime-env.ts`: `isSiteImportEnabled()` reading `EXPO_PUBLIC_ENABLE_SITE_IMPORT === "true"` (clone the Share Deal accessor at line 205, including the debug-dump entry at ~line 135).
2. New state: `siteImport` (`null | "loading" | SiteImportResult | "error"`), `selectedLogoCandidate: number | null`, `importItems: MenuRow[]` (kept rows), `importConsent: boolean`.
3. Card renders only when `isSiteImportEnabled() && websiteUrl` (the field populated by `applyLookupResult`). Contents per §1. Reuse existing button/banner components and styles in the file — no new design language, minimal words (Dan's copy preference).
4. Logo selection: on choosing a candidate, write the base64 payload to a cache file via `expo-file-system` (`FileSystem.cacheDirectory + "import-logo-<ts>.<ext>"`, `writeAsStringAsync(..., { encoding: FileSystem.EncodingType.Base64 })`) and `setLogoUri(fileUri)`. The existing `uploadLogo()` (`fetch(logoUri)` → blob → storage upload) then works with **zero changes**. Verify `expo-file-system` is already a dependency (it ships with Expo SDK 54 templates; if absent, stop and flag rather than adding a dependency silently).
5. Menu persistence: in **both** submit branches (edit path after the business update ~line 485-498, create path after `bizData?.id` exists ~line 522-528), if `importItems.length > 0 && importConsent`:
   ```ts
   const payload = importItems.map((r, i) => ({
     business_id, name: r.name, category: r.category?.trim() || null,
     price_text: r.price_text?.trim() || null,
     size_options: r.size_options?.length ? r.size_options : null,
     sort_order: i, source: "import" as const,
   }));
   await supabase.from("business_menu_items").insert(payload);
   ```
   (Exact shape from `menu-scan.tsx:311-320`.) Dedupe first against existing library rows for the business by lowercased `name` (cheap select of `name` where `business_id`), skipping duplicates silently. Insert failure → non-fatal banner ("Couldn't save menu items — you can scan your menu later."), never block the business save.
6. Consent unchecked or import skipped → behavior identical to today.
7. Accessibility + dark mode: use existing themed components in the file; check both themes (the recent F-014a lesson: hardcoded light-mode colors in this exact area of the app).

Validation: `npm run typecheck`, `npm run lint`, `npm test` all green. Then a local QA pass on the Android emulator or dev APK **only if Dan asks for device QA** (per CLAUDE.md emulator rules); otherwise code review + tests.

---

## 8. WI-6 — Localization

All new strings in `lib/i18n/locales/en.json`, `es.json`, `ko.json` under `businessSetup.import.*`:
card title, scan button, spinner line ("This can take about 20 seconds"), logo section header, menu section header + remove hint, consent line, import/skip buttons, and one generic failure line ("We couldn't read your website. You can add everything manually."), plus warning variants for `MENU_NOT_FOUND` and the menu-PDF case. Real Spanish and Korean translations (match register of neighboring keys; Spanish uses Mexican conventions per repo precedent). Keep copy minimal — few words per Dan's standing preference.

If any of this copy is AI-promotional (it is not — it's UI chrome), `npm run copy:evaluate` would apply; as specced it does not.

---

## 9. Security & policy requirements (non-negotiable summary)

- SSRF: https-only, port 443 only, no credentials/IP-literal hosts, DNS-resolved IPs checked against the full private/reserved table, manual redirects re-validated per hop (max 3), per-fetch timeout 10 s, byte caps streamed (2 MB html / 512 KB image / 5 MB pdf), content-type allowlists.
- Consent: content persists only after the explicit "this is my website" confirmation. We import only from the URL attached to the business's own profile.
- Never store Google Places photos (ToS) — this feature deliberately fetches the business's own site instead.
- No upstream bodies/secrets in responses or logs; log hostnames + counts only.
- Rate limit 10 scans/user/day (env-tunable) + the AI call rides the existing provider-router circuit breakers and cost ledger (`feature: "site_import"`).
- Deal-fact integrity: imported items land in the owner's menu library only after human review; nothing feeds a deal without the owner selecting it in the existing create flow. Deterministic fallback exists at every step (manual entry, photo scan).

---

## 10. Test & validation matrix

| Layer | Check |
|---|---|
| `_shared/site-import.ts` | vitest: extractor fixtures, SSRF IP table (boundary-exact), URL validator, htmlToMenuText caps, prompt snapshot |
| Edge handler | `npm run typecheck:functions`; logic thin by design |
| `lib/business-site-import.ts` | vitest wrapper tests (per §6) |
| App | `npm run typecheck`, `npm run lint`, full `npm test` (1278+ tests must stay green) |
| Prompt rule (CLAUDE.md) | `buildSiteMenuPrompt` snapshot + normalizer regression tests = the required fixture coverage |
| Live smoke (post-deploy, Dan-gated) | Scan 2-3 real DFW-style sites (a Squarespace restaurant, a Wix café, a no-website control) against the **dev** Supabase project first; verify ledger rows appear under `site_import`; verify 429 after limit |

---

## 11. Ship sequence (every step 🔒 Dan-approved, in this order)

1. Code review of the full diff on a branch (no push without approval).
2. Apply WI-1 migration to prod → `node scripts/probe-rls-smoke.mjs`.
3. Deploy `import-business-website` (dev project first for smoke, then prod). Set `SITE_IMPORT_DAILY_LIMIT` only if a non-default is wanted.
4. Add `EXPO_PUBLIC_ENABLE_SITE_IMPORT=true` to the relevant `eas.json` env blocks (file edit is code; taking effect requires a build).
5. New app build (hard-gated). Until that build ships, everything is dormant: fn deployed but uncalled, migration additive, UI flag off in old builds.

Rollback at any point = leave flag unset / remove it; no data or schema rollback needed.

---

## 12. Phase 2 (explicitly NOT in this plan's scope)

- **Site photos → AI create photo picker.** The natural home is the existing owner-photo path (`lib/upload-deal-photo.ts`, `photo_source: "uploaded_original"`), but the picker lives in `app/create/ai.tsx` which is **locked** — requires Dan's per-file approval and its own plan.
- Menu-item enrichment of `ai-deal-suggestions` prompts beyond what it already reads from the table.
- JS-rendered sites via a rendering service; Facebook/Instagram-only businesses (ToS-blocked — the fallback is the existing camera menu scan).
- Re-import/refresh from the account screen (v1 is onboarding-time only; the card can also render in edit mode for free since business-setup serves both, which is acceptable if it falls out naturally — do not build extra surface for it).

---

## 13. Acceptance checklist (definition of done for v1)

- [ ] All WI-1…WI-6 merged on a branch; commits scoped per work item; nothing pushed without approval.
- [ ] `npm run typecheck` / `lint` / `test` / `typecheck:functions` all green; no existing test modified to pass.
- [ ] No locked file touched (`git diff --name-only` audited against `docs/ai-poster-core-lock.json`).
- [ ] Flag off → app byte-for-byte behavior identical (UI absent, no new network calls).
- [ ] Flag on + happy path: Places lookup → scan → select logo + confirm items → submit → `businesses.logo_url` set, `business_menu_items` rows with `source='import'`, create-deal flow shows the items.
- [ ] Flag on + failure paths: unreachable site, empty site, menu-PDF-only site, rate limit — each shows one calm localized line and onboarding proceeds manually.
- [ ] en/es/ko keys present and rendered (spot-check `es`/`ko` by switching device language).
- [ ] Ledger rows visible under feature `site_import` after live smoke (post-deploy step).
