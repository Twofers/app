# Translate — trilingual deal display plan (2026-07-22)

> **PLAN — nothing implemented.** Dan's decisions are recorded below; implementation
> starts on his go. Grew out of the 2026-07-22 viewer-language investigation
> (see `project_deal_viewer_language_investigation_2026_07_22` memory and
> `docs/localization/viewer-language-invariant-plan.md`).

## Priorities (Dan, verbatim intent)

1. **The best deal creation.** Nothing in this plan may touch the merchant
   create/publish flow, its validators, its hashes, or the AI prompts. All work
   is customer-display-side or build config.
2. **The translations.** Deal content should render in the viewer's language —
   truly trilingual; if anything looks like it could break, Spanish + English
   first and Korean waits.

Dan's decisions (2026-07-22, all confirmed):

| Question | Decision |
| --- | --- |
| Item names | **Everything, brands too** — no category is excluded on principle |
| Engine | **Bigger dictionary only** — no AI, no publish-flow changes |
| Korean | **Ship it best-effort — no native spot-check ("just do your best")** |
| Merchant do-not-translate list | **Keeps winning** (Dan confirmed) over the translate-everything default |
| Rebuild | **T1 + T2 (+ Korean) ride one rebuild together** |

Reconciliation of the first two (stated so it is not discovered later): a
dictionary-only engine translates whatever it has an entry for and passes the
rest through. So "brands too" here means **no brand carve-out exists** — the
dictionary decides, and we may add brandish menu terms to it — but an arbitrary
invented name the dictionary has never seen still passes through unchanged.
Literal 100% coverage of unknown names requires the deferred AI-at-publish
phase (T5), which Dan declined for now.

Two protections stay in place regardless (**Dan confirmed the first**):
- The **merchant's own do-not-translate list** (`doNotTranslateTerms`) is
  explicit merchant intent and keeps winning over the dictionary.
- **Business names** are never translated (separate render element; locked
  product decision).

### Korean without a reviewer — why "just do your best" is safe enough

No native speaker will check Korean before customers see it. That is acceptable
**only** because of how this engine fails, and the plan leans on that:

- The renderer builds from language-neutral structured facts, so the **numbers
  and offer mechanics are always correct** in Korean — a mistranslation cannot
  change 40% into something else or invert a BOGO.
- A Korean viewer **never sees English text** and never sees a broken string;
  the worst case is a stiff, less-fluent phrasing (the counter-free "field
  dump" form), which is factually right, just not graceful.
- Korean dictionary entries are added **conservatively**: only item names I am
  confident about go in; anything uncertain passes through rather than being
  guessed, so I never invent a wrong Korean noun.
- The **per-language switch is the safety valve**: if the Korean matrix (T2)
  reads badly to me, `ko-KR` simply stays out of the enabled list and ships
  `en-US,es-US` only — exactly Dan's "if it could break, Spanish and English
  first" — with Korean flipped on later by config + OTA, no code change.

Net: unreviewed Korean risks *awkward*, never *wrong* or *English*. That is the
bar "do your best" has to clear, and it clears it.

## Verified current state (probed 2026-07-22, offline renderer run)

- EN-authored deal, dictionary item: **already fully trilingual.**
  "40% off iced tea" → es "Recibe 40% de descuento en 1 té helado", ko
  "아이스 티 1잔 40% 할인". The ~400-term reviewed dictionary
  (`lib/localized-offer-terms.ts`) is live on the customer render path.
- **Gap A — coverage:** unknown item passes through. "strawberry matcha" stays
  English inside the Spanish sentence, and Korean drops to the field-dump
  format ("할인 항목: strawberry matcha × 1") because no counter word attaches.
  The Korean-quality issue is a symptom of the coverage issue.
- **Gap B — reverse direction:** KO-authored "아메리카노" renders for an EN
  viewer as "Buy one 아메리카노 and get one free" — the source-term→English
  lookup (`SOURCE_TERM_TO_ENGLISH_DICTIONARY`) missed. Root cause TBD
  (missing entries vs normalization).
- **Gap C — poster visual:** `AdPosterCanvas` is pinned to `en-US` copy in
  production because `EXPO_PUBLIC_POSTER_VIEWER_LANGUAGE_ENABLED` is absent
  from `eas.json` (`AdPosterCanvas.tsx:804-808` → `posterCopyFromSpec`).
  es/ko copy already exists in the poster spec (`copy_by_language`).
- **Out of scope per Dan:** legacy deals with no structured facts.

Key mechanism facts: `resolveLocalizedOfferTerm`
(`lib/localized-offer-terms.ts:1278`) resolves providedTerms → merchant
do-not-translate → dictionary → pass-through; the renderer
(`lib/localized-offer-renderer.ts:31,210`) already accepts `providedTerms`.
The customer path is `buildLocalizedDealDisplay` (`lib/localized-deal-display.ts`),
used by all five customer surfaces and pinned by
`lib/customer-localized-paths-source.test.ts`.

## Hard safety rules (how "cannot affect deal creation" is enforced)

- **Display-side only.** No edits to `app/create/*`, publish RPC, edge
  functions, prompts, image generation, or anything that feeds a publish-time
  hash (the July-22 publish-block bug was exactly a hash-input divergence —
  we do not go near those inputs).
- **Every behavior change sits behind its own build-time switch, default off.**
  Switch off ⇒ byte-identical output to today, enforced by snapshot tests
  written BEFORE the change (T0).
- **Kill switch mechanics, stated honestly:** these are `EXPO_PUBLIC_*`
  build-time flags. Fast rollback = flip the flag and ship an `eas update`
  (JS-only OTA, minutes, no store review). Full rollback = rebuild. Both are
  Dan-gated actions.
- **Locked-file protocol:** before editing, confirm which touched files are in
  `docs/ai-poster-core-lock.json` (likely candidates:
  `lib/localized-offer-renderer.ts`, `lib/localized-offer-terms.ts`,
  `lib/localized-deal-display.ts`). Each locked file gets its own approval
  line from Dan, and the approval chain is appended (never overwritten), with
  hash updates after the approved edit.
- **Source guard:** a new test asserts the create path does not import the
  expansion module, so the item-name work can never leak into creation.

## Phases

### T0 — Guard rails first — DONE 2026-07-22

Safety net in place before any behavior change (all new, unlocked files):
- **Baseline snapshot** `lib/deal-item-translation-baseline.test.ts`
  (+ `__snapshots__/…snap`): freezes today's deterministic offer line for the
  9-fixture × 3-viewer matrix, rendered on the true customer path
  (`renderLocalizedOfferFromDefinition`, no providedTerms). Plus hard `toBe`
  pins for the coverage gap, reverse direction, and brand preservation so they
  survive `vitest -u`.
- **Source guard** `lib/deal-item-translation-create-isolation-source.test.ts`:
  scans all 10 `app/create/**` screens and fails if any imports the T2
  expansion module or the switch. This is how "cannot affect deal creation"
  becomes enforced.
- **Lock audit — clean result:** the item-name work (T2) touches **zero**
  locked files (`localized-offer-terms.ts`, `localized-offer-renderer.ts`,
  `localized-deal-display.ts`, `deal-localization.ts`, `runtime-env.ts` and
  their tests are all unlocked; `eas.json` too). Only T1 *might* touch a locked
  file if the poster es-locale key needs fixing inside `AdPosterCanvas.tsx` /
  `posterCopy.ts` — the resolver itself (`posterAdSpec.ts`) is unlocked, so T1
  may avoid locked files entirely. `gate:ai-poster-lock` = 30/30 unchanged.
- Validation: 9/9 new tests pass, `tsc` 0, eslint clean.

**What the baseline revealed (sharpens T2):**
- Coverage is asymmetric per language, not just per item: "cold brew" → ko
  "콜드브루" but es keeps "cold brew"; "iced tea" → es "té helado". So the
  Spanish table needs filling too, item by item.
- Reverse direction is entry-specific: "café de olla" → EN "spiced coffee"
  already works, but "아메리카노" stays Hangul for EN and ES viewers.
- The Korean field-dump ("할인 항목: X × 1") fires exactly when the ko item has
  no counter id — so adding ko entries *with* counter ids fixes coverage and
  the awkward format together.

### T1 — Poster viewer language — FLAG ON in dev; wiring VERIFIED; needs a fresh deal to see it (2026-07-22)

Enabled `EXPO_PUBLIC_POSTER_VIEWER_LANGUAGE_ENABLED=true` in `.env.development.local`
and device-tested via Metro. Finding: the poster still renders **English** on the
pre-existing "COFFEE + COOKIE BREAK" deal, even with Korean selected in the
in-deal switcher. Diagnosed — this is **not** a code bug:
- Deal detail passes `contentLocale` to the poster (`app/deal/[id].tsx:927`).
- `posterCopyForLocale` (`lib/poster/posterAdSpec.ts:34-39`) looks up
  `copy_by_language[locale]` with an en-US fallback, using `es-US`/`ko-KR`
  consistently — no es-MX↔es-US mismatch (the earlier agent's es-MX note was
  wrong). `parsePosterSpecV1` only keeps locales the stored record contains.
- So a poster localizes only if its STORED spec has es-US/ko-KR copy. Poster
  specs are frozen at publish and never backfilled, so **old deals stay English**
  (unchanged, safe) and only **newly-published deals** carry localized poster copy.

Consequence: enabling T1 is safe (zero regression on existing deals), but its
benefit shows only on deals published after it's on. To device-confirm a
localized poster, publish a fresh deal — needs the business account (currently
logged out). No code change required for T1; the flag + existing wiring are
correct. eas.json (production) NOT yet set — that's the ship/rebuild decision.

Original T1 notes:

- Set `EXPO_PUBLIC_POSTER_VIEWER_LANGUAGE_ENABLED=true` in `eas.json`
  (production + preview) and `.env.development.local` (dev APK).
- Verify, with tests where missing: customer surfaces pass `contentLocale`
  into `AdPosterCanvas`; `posterCopyForLocale` key mapping handles the
  spec's `es-MX` keying vs the app's `es-US` locale; the schedule/"redeem by"
  line localizes; specs missing a locale fall back to English (already coded:
  `?? posterCopyFromSpec`).
- Device QA on the dev APK: view an existing poster deal as a shopper in
  Spanish and Korean; screenshot evidence.
- Kill switch: the flag itself. Expected code delta: zero to tiny.
- Requires an app rebuild to reach customers (Dan-gated, can ride the next
  scheduled build — several other fixes are already queued on a rebuild).

### T2 — Item names — DONE 2026-07-22 (built, dark, uncommitted)

Implemented, tested, self-reviewed. Ships **dark** — the switch is unset in
`eas.json`, so behavior is byte-identical to today until Dan enables + rebuilds.
Zero locked files touched.

Files:
- NEW `lib/localized-offer-terms-expansion.ts` — ~80 curated DFW café/bakery/
  restaurant entries (forward en→es/ko and reverse ko/es→en), Korean using only
  the three reviewed counters. Consulted ONLY when the base misses (base always
  wins → no reviewed term regresses).
- NEW `lib/deal-item-translation-flag.ts` — dependency-free (no expo-constants)
  reader for `EXPO_PUBLIC_DEAL_ITEM_TRANSLATION_LOCALES` (per-viewer switch).
- `lib/localized-offer-terms.ts` — `extraDictionary` threaded through
  `resolveLocalizedOfferTerm`/`dictionaryTerm`, exported dictionary type.
- `lib/localized-offer-renderer.ts` — `extraDictionary` render option, passed to
  both term resolutions; NOT read by the bundle builder, so publish/create specs
  and hashes are unchanged.
- `lib/localized-deal-display.ts` — the single customer render call passes the
  expansion only when the switch enables `params.locale`. (Create never calls
  this; verified no `app/create/**` file imports it.)
- NEW test `lib/deal-item-translation-expansion.test.ts` — proves the gap closes,
  reverse works, base never overridden, per-locale gating, and — since Korean is
  unreviewed — that **every Korean counter used is natively reviewed**.

Architecture note (why creation is provably safe): the expansion is a pure
render-time transform on the CUSTOMER display path, downstream of storage. It
never touches the offer definition, the stored `ad_spec`, the localization
bundle, or any publish hash. Switch-off passes `extraDictionary: undefined`, so
`renderLocalizedOfferFromDefinition` is byte-identical — the T0 baseline snapshot
is unchanged.

**Korean review (mine, no native reviewer):** rendered all ~80 items; output is
natural (counters 잔/개/인분 placed correctly, correct transliterations). Caught
and fixed one real error — matcha was written 마차 ("carriage") and is now 말차,
matching the base's `말차 라떼`. Verdict: **ko-KR is good enough to ship enabled.**
The three-counter constraint keeps it safe; anything uncovered falls back to the
terse-but-correct form, never English, never wrong facts.

Validation: full suite **280 files / 1929 tests green**, `gate:ai-poster-lock`
30/30, `copy:evaluate` fixtures pass, `tsc` 0, eslint clean (1 pre-existing
`Array<T>` warning on an untouched line). Coverage is a strong starter set, not
exhaustive — unknown items still pass through (that is the by-design behavior;
literal 100% is the declined AI phase T5).

---

Original T2 design notes (kept for reference):

The core work. All of it inside the terms/display libs.

- **New switch** `EXPO_PUBLIC_DEAL_ITEM_TRANSLATION_LOCALES` — a comma list of
  *viewer* locales whose NEW item-name output is enabled. Default `""` = off =
  today's behavior. Target enablement: **`"en-US,es-US,ko-KR"`** (truly
  trilingual). The `ko-KR` code is built here alongside es; whether it is in the
  enabled list at rebuild time is my judgment after the T2 Korean matrix review
  (below) — if it reads badly, ship `"en-US,es-US"` and add `ko-KR` later by
  config + OTA. The switch is per-locale precisely so that call is reversible
  without a code change.
- **Expansion tables**, separate from the existing reviewed base (which stays
  untouched so switch-off provably equals today): several hundred new
  DFW-menu-relevant en→es/ko entries (drinks, bakery, café food, common
  compounds like "strawberry matcha"), each ko entry carrying a counter id so
  the field dump stops firing for covered items; plus reverse (es/ko → en
  pivot) entries. **Korean entries are added conservatively (confident nouns
  only; uncertain ones pass through, never guessed) since no native review
  gates them.**
- **Korean matrix review (mine, since no reviewer):** after the ko entries land,
  I render the full T0 fixture matrix in Korean and read every line. If it
  reads cleanly, `ko-KR` ships enabled; if not, it ships disabled and I say so.
  This replaces the deleted native-spot-check gate.
- **Fix Gap B properly:** diagnose why 아메리카노 missed the reverse lookup
  (absent entry vs normalization bug) and add a regression test either way.
  Reverse-table inversion must be unambiguous — an automated test rejects
  colliding entries; ambiguous terms are skipped (pass through) rather than
  guessed.
- **No brand carve-out** (Dan's decision): nothing is excluded because it
  "looks like a brand"; the dictionary decides. Merchant do-not-translate and
  business names keep their protections (above).
- Tests: T0 matrix re-run with the switch on, every diff eyeballed;
  switch-off snapshot equality; inversion-collision test; `npm run
  copy:evaluate` since rendered offer copy changes (CLAUDE.md validation rule).
- Rollout: ships dark (switch off), enabled for en+es in the same rebuild as
  T1 after device QA.

### T3 — (folded into T2) Korean ships in the same rebuild

No separate spot-check phase — Dan: "no one will spot check, just do your best."
Korean is built and reviewed (by me) inside T2 and enabled in the same rebuild
unless my matrix review says hold. The Korean "field dump" fallback sentence
style is explicitly NOT redesigned (out of scope); T2's coverage work shrinks
how often it appears. Kept as a heading only so the numbering stays stable.

### T4 — Website tie-back (optional, after T1 is in a build)

With posters rendering Spanish natively, capture a real Spanish poster in-app
and wire the website business-band image through the existing `data-i18n-src`
mechanism (the deferred website Phase 3).

### T5 — Deferred: AI-at-publish item names (NOT approved)

The only way arbitrary unknown/brand names ever hit 100% translation. Touches
the publish path, costs per deal, needs its own approval round. Recorded so
the option isn't lost; Dan declined it for now.

## Validation per phase

`npm run typecheck`, `npm run lint`, `npm test`, `npm run copy:evaluate`
(T2), fixture/lock updates, and dev-APK device QA with screenshots. Rebuild
and any `eas update` are Dan-gated. Prereq note: generating NEW poster deals
for QA needs the business account signed back into the S10; viewing existing
ones works from the shopper session.

## Open items for Dan

All resolved 2026-07-22:
1. ~~Merchant do-not-translate list wins~~ — **confirmed yes.**
2. ~~Korean spot-check owner~~ — **none; ship best-effort** (safety story above).
3. ~~Rebuild timing~~ — **T1 + T2 (+ Korean) ride one rebuild.**

Nothing blocks starting. Next action on Dan's go: **T0** (guard-rail snapshot
tests + create-path source guard + locked-file approval list). The one action
that will need explicit approval mid-flight is editing any file in
`docs/ai-poster-core-lock.json`; I will list the exact files and intended
change before touching them.
