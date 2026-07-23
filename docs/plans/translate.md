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

### T0 — Guard rails first (~half day)

Write the safety net before touching anything:
- Fixture matrix snapshot tests capturing TODAY's renderer output:
  3 source languages × 3 viewer languages × {dictionary hit, miss, brandish
  name, size-modified item, ko counter / no-counter}. Every later diff is
  reviewed against these.
- Source-guard test: `app/create/**` must not import the new expansion module.
- Lock-coverage check + per-file approvals from Dan for any locked file.

### T1 — Poster viewer language ON (~1h + QA)

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

### T2 — Item names: coverage + reverse direction, per-language switch (~1–2 days)

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
