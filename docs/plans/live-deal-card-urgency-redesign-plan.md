# Plan: Redesign the live-deal card status / time / action area

**Requested by:** Dan, 2026-07-09
**Executor:** Opus (follow this plan; audit first, then implement)
**Scope:** Consumer feed deal cards (`components/composed-ad-card/*`) — presentation only. No data, claim, publish, or AI-generation logic changes.

---

## 1. The complaint (Dan's words, mapped to code)

On live deal cards in the consumer home feed:

1. **A small yellow "LIVE" box and next to it a small time box ("2h 21m left") that is hard to read.**
   → `components/composed-ad-card/AdStatusBadges.tsx`: badges render at `fontSize: 11`, `fontWeight: 900`, `textTransform: uppercase`, and can shrink further (`minimumFontScale: 0.78`). The LIVE badge uses the orange accent (`tokens.ctaBackground`, `#FF9F1C`); the time badge uses the dark `badgeBackground`. The most time-sensitive information on the card is the smallest text on it.

2. **The same time remaining appears again right under the badges.**
   → `components/composed-ad-card/templates/PosterOfferTemplate.tsx:10`:
   `const scheduleLine = offerFacts.scheduleSummary || liveState.timeRemainingLabel || liveState.statusLabel;`
   When a deal has no `scheduleSummary` (most one-time deals), this line falls back to the exact same `timeRemainingLabel` string already shown in the badge row above it → literal duplicate ("2H 21M LEFT" badge + "2h 21m left" line).

3. **"Saved" is inside the same box as "Claim deal" and doesn't belong there.**
   → The feed (`app/(tabs)/index.tsx:1175-1180`) passes a `secondaryAction` (Save favorite / Saved, heart icon) into `ComposedAdCard`, and `AdCallToAction.tsx` renders it at near-equal visual weight beside/below the primary Claim button (stacked vertically in the poster template's 154px action column). Saving a business is a browse-time affinity action, not part of the claim decision; it competes with the primary CTA.

The template Dan is seeing is most likely `PosterOfferTemplate` (deals published with a native poster spec; `posterSpec.enabled` short-circuits template selection in `ComposedAdCard.tsx:13`). But `LiveDropCardTemplate` and `SplitOfferPanelTemplate` share the same tiny-badge row and the same CTA+Saved row, so the fix must cover all consumer-feed templates consistently.

---

## 2. Target design

### 2a. One urgency line instead of badge soup

Replace the row of small uppercase chips with a **single readable status line** for live deals:

```
● Live · 2h 21m left · Only 2 left
```

- Rework **inside `AdStatusBadges.tsx`** keeping its existing props (`liveState`, `tokens`, `showLiveStatus`, `showQuantityRemaining`, `showTimeRemaining`) so all templates inherit the fix without signature churn.
- Live state: a small accent-colored dot (8px circle, `tokens.ctaBackground`) + the status label + separators (`·`) + time remaining + scarcity, on **one line**, `numberOfLines={1}`, ellipsize tail.
- Typography: `fontSize: 13`, `lineHeight: 18`, `fontWeight: "700"`, **sentence case** (no `textTransform: uppercase`), color `tokens.panelText` for the time (it's the payload), status word can be `tokens.panelMutedText` or accent — keep contrast AA on `panelBackground`.
- Scarcity ("Only 2 left") may render with modest emphasis (accent color), since it's the strongest urgency signal — but same size, same line.
- Non-live states (Claimed / Redeemed / Expired / unavailable): keep a single compact chip like today (these are calm states; a chip is fine), or render the same one-line pattern without the dot — executor's choice, but only ONE element, never a chip row.
- Respect existing `maxFontSizeMultiplier={1.15}` convention.
- Order labels: status → time → quantity, and dedupe: if `timeRemainingLabel === statusLabel` skip one (defensive).

### 2b. Remove the duplicate time line in PosterOfferTemplate

In `PosterOfferTemplate.tsx`:
- `scheduleLine` becomes `offerFacts.scheduleSummary` **only** (a real schedule like "Weekdays 2–5 PM" is additional information; a repeated countdown is not).
- If `scheduleSummary` is empty, render **nothing** there — the urgency line above already carries time remaining. Never fall back to `timeRemainingLabel` or `statusLabel`.
- Note: deal detail (`app/deal/[id].tsx:797`) passes `validitySummary` as `timeRemainingLabel`, so detail keeps its richer validity text via the urgency line — verify it still reads well there (surface `deal_detail`).

### 2c. Move Saved out of the action block

- **Feed** (`app/(tabs)/index.tsx`): stop passing `secondaryAction` into `ComposedAdCard`. Instead pass a new optional prop, e.g. `favoriteAction: { selected, onPress, accessibilityLabel }`.
- Templates render `favoriteAction` as a **heart icon button overlaid on the top-right corner of the image** (the standard save pattern — Airbnb/DoorDash/Yelp):
  - 40–44px circular hit target (`hitSlop` to reach 44 if visual is smaller), subtle dark scrim circle (`rgba(0,0,0,0.35)`) behind a white heart outline; filled heart + accent/rose when selected, matching the favorites accent used in `app/deal/[id].tsx` header (`theme.favorite`).
  - Must not overlap poster text: poster copy is top-left/bottom anchored; top-right corner is safe. Add it in each template's image container (`styles.image` wrapper / above `AdPosterCanvas` in the poster template) — **do not modify `AdPosterCanvas.tsx` (locked file)**; overlay from the template.
  - `accessibilityRole="button"`, `accessibilityState={{ selected }}`, keep the existing labels (`dealDetail.favorited` / `dealDetail.favorite`).
- `AdCallToAction.tsx`: primary Claim button becomes **full-width** in all templates. Keep the `secondaryAction` prop and stacked variant working (types stay backward-compatible; other callers/templates like Social/Signature/Hero still reference it), but the consumer feed no longer uses it. If after auditing no runtime caller passes `secondaryAction` anymore, it may be marked deprecated in `types.ts` — do not delete it in this task.
- The poster template's cramped 154px `action` column can then relax: put the Claim button full-width **below** the schedule/urgency content instead of squeezing it into a right column.
- Deal detail already has its own header heart (`app/deal/[id].tsx:806`) and passes no `secondaryAction` — no change needed there; do not add a second heart on the detail card.

### 2d. Time format

- Keep the existing localized strings `consumerHome.timeLeftHM` ("{{h}}h {{m}}m left") and `consumerHome.timeLeftM` ("{{m}}m left") — the complaint is legibility, not wording, and reusing keys avoids a 3-locale copy pass.
- **Optional polish (do only if trivial):** when under 5 minutes, show a localized "Ends soon" instead of "1m left" — requires new keys in `lib/i18n/locales/en.json`, `es.json`, `ko.json` (all new user-facing copy must be localized in all three).

---

## 3. Files to change

| File | Change |
|---|---|
| `components/composed-ad-card/AdStatusBadges.tsx` | Chip row → single urgency line (2a) |
| `components/composed-ad-card/templates/PosterOfferTemplate.tsx` | Drop time fallback in `scheduleLine` (2b); full-width CTA; heart overlay slot (2c) |
| `components/composed-ad-card/templates/LiveDropCardTemplate.tsx` | Heart overlay on image; CTA row without secondary (2c) |
| `components/composed-ad-card/templates/SplitOfferPanelTemplate.tsx` | Same as LiveDrop (2c) |
| `components/composed-ad-card/types.ts` | Add optional `favoriteAction` to `ComposedAdCardProps` |
| `components/composed-ad-card/ComposedAdCard.tsx` | Thread new prop through (template props are spread — may be zero-change) |
| `components/composed-ad-card/AdCallToAction.tsx` | Full-width primary when no secondary rendered |
| `app/(tabs)/index.tsx` | Replace `secondaryAction={...}` with `favoriteAction={...}` (~line 1175) |
| `lib/i18n/locales/{en,es,ko}.json` | Only if optional "Ends soon" copy is added |

Also verify (likely no change needed): `LocalDiscoveryTemplate.tsx`, `HeroImageOverlayTemplate.tsx`, `SocialMomentTemplate.tsx`, `SignatureItemTemplate.tsx` — they consume `AdStatusBadges`/`AdCallToAction` and will inherit the new urgency line; confirm their layouts don't break (they're used by owner-side previews / representative previews).

---

## 4. Guardrails — read before editing

1. **Locked files (AI poster core lock — do NOT edit):** `components/poster/AdPosterCanvas.tsx`, `app/create/ai.tsx`, `lib/ad-spec.ts`, `lib/create-ai-ux-source.test.ts`, and everything else in `docs/ai-poster-core-lock.json`. The composed-ad-card templates being changed here are **not** in the lock list — verified 2026-07-09. `npm test` runs the lock checker; if it flags anything you touched, stop and revert.
2. **Owner preview parity:** `app/create/ai.tsx` renders the same composed templates in the merchant "Standard preview". This redesign will change how that preview *looks* (not what it publishes). This is expected fallout, and Dan asked for the redesign — but do not edit `app/create/ai.tsx` itself. If the preview needs a code change to accommodate the new prop, stop and ask Dan (locked file).
3. **Source-guard tests that constrain you:**
   - `lib/deal-poster-aspect-ratio-source.test.ts` — every composed template must keep `aspectRatio: 1` on the image slot. The heart overlay goes *inside* the square container; don't change its dimensions.
   - `lib/composed-ad-card-parity-source.test.ts` — home + detail must keep referencing `ComposedAdCard`, `buildDefaultAdPresentationSpec`, `buildMerchantIdentity`, `buildApprovedAdCopy`, `renderAuthoritativeOffer`.
   - Grep for other source tests referencing files you touch before assuming green (`Grep "composed-ad-card" **/*.test.ts`).
4. **Accessibility text:** `AdAccessibilityText.tsx` builds the card label from `liveState` fields — it stays correct untouched. Keep `accessibilityState.selected` on the heart.
5. **Deal facts are authoritative** — this task must not alter any offer/copy strings, only their presentation.
6. **Localization:** any new user-visible string goes into en + es + ko locale files. No hardcoded English.
7. Don't touch `presentation.show*` flag semantics or `lib/ad-presentation-spec.ts` — stored specs in prod already carry these booleans; the redesign only changes how enabled labels render.

---

## 5. Validation

1. `npm run typecheck`
2. `npm run lint`
3. `npm test` (includes the poster core-lock checker and the source guards above)
4. Manual/emulator sanity (only if Dan asks for emulator QA): feed card in light + dark (`dark_neutral` theme tokens), a live deal with scarcity, a live deal without scarcity, a claimed deal, an expired deal, a poster-spec deal (PosterOfferTemplate) and a photo deal (SplitOfferPanel/LiveDrop), long Korean/Spanish time strings on one line.
5. No `copy:evaluate` needed (no AI prompt/copy changes). No migrations, no deploys, no rebuild performed by the agent — note that Dan needs an app rebuild to see it on-device.

## 6. Acceptance criteria

- Live card shows exactly **one** time-remaining string, in ≥13px sentence-case text, readable at a glance.
- No uppercase 11px chip row on live cards.
- "Claim deal" is the only button in the action area, full width.
- Save/Saved is a heart on the image corner, 44px target, correct selected state, still toggles the same `toggleFavorite(item.business_id)`.
- Claimed/Redeemed/Expired states still clearly labeled.
- All three locales render on one line without clipping.
- Typecheck, lint, and full test suite green; no locked-file hash changes.
