# QA report — deal validation, AI publish flow, keyboard handling

**Date:** 2026-03-29  
**Scope:** Changes from the sessions covering (1) deal-quality / strong-deal wording, (2) Quick deal + AI Compose + menu-offer routing and publish behavior, (3) AI ads preview UI, (4) `KeyboardScreen` + form scroll props across form surfaces.

---

## 1. Automated verification (executed)

| Check | Result | Notes |
|--------|--------|--------|
| `npx vitest run` | **Pass** — 12 files, 98 tests | Includes `deal-quality.english-regression.test.ts`, `strong-deal-guard.test.ts`, and full suite |
| `npx tsc --noEmit` | **Pass** | No type errors |
| `npx expo lint` | **Pass (warnings only)** | 10 pre-existing warnings elsewhere; `keyboard-screen.tsx` duplicate-import warning **fixed** (single `react-native` import) |

---

## 2. On-device / agent-device (not executed)

| Check | Result | Notes |
|--------|--------|--------|
| `npx agent-device open … --platform android` | **Blocked** | `DEVICE_NOT_FOUND` — no Android device or emulator connected on this machine |

**Implication:** Keyboard behavior, navigation transitions, and visual layout were **not** runtime-verified on hardware. Follow the manual matrix below on an Android emulator or device (project primary target per `CLAUDE.md`).

---

## 3. Code-level verification (static)

| Area | Verified | Method |
|------|----------|--------|
| “Get one free” / BOGO shorthand | `lib/deal-quality.ts` includes `\bget\s+one\s+free\b` / `\bget\s+1\s+free\b` in core + structural patterns; regression test **“Buy on cola get one free”** | Grep + vitest |
| Strong-deal parity | Same patterns in `lib/strong-deal-guard.ts` and `supabase/functions/_shared/strong-deal-guard.ts` | Grep |
| Quick deal quality uses hint | `publishDeal` passes `description: offerHint` into `assessDealQuality` / `validateStrongDealOnly`; insert saves `deals.description` when hint non-empty | Read `app/create/quick.tsx` |
| AI suggest title | Validates quality + strong guard **before** `setTitle` | Read `suggestTitleFromAi` |
| Menu-offer → AI | `router.push` → `/create/ai` with `prefillTitle`, `prefillPromoLine`, `prefillCta`, `prefillDescription`, `prefillHint` | Read `app/create/menu-offer.tsx` |
| AI Compose → AI | Same pattern + optional `prefillPosterPath` | Read `app/create/ai-compose.tsx` |
| AI prefill effect | `useEffect` skips when `templateId` set; applies poster via `buildPublicDealPhotoUrl` | Read `app/create/ai.tsx` |
| i18n | `menuOffer.useAiPublish`, `createAi.variantPublishedPreview`, `variantListingBodyLabel`, `variantNeedsPhotoForPreview` present in en / es / ko | Grep `lib/i18n/locales` |

---

## 4. Manual test matrix (required on device)

Complete each row on **Android** (and optionally iOS). Mark **Pass / Fail / N/A** and note build (Expo Go vs dev client).

### 4.1 Deal copy & Quick publish

| # | Steps | Expected |
|---|--------|----------|
| M1 | Quick deal: put BOGO only in **Offer hint**, short/generic **Title**, publish | Publish succeeds; listing stores hint in `description` (visible where feed shows description) |
| M2 | Quick deal: **Suggest title with AI** with strong hint | Title updates only if quality + strong-deal pass; otherwise banner, title unchanged |
| M3 | Title + hint: “Buy one get one free” / cola wording | No erroneous “clarify value” block if patterns match |

### 4.2 Routing & AI ads

| # | Steps | Expected |
|---|--------|----------|
| M4 | Menu offer → generate ads → primary CTA | Lands on **Create (AI ads)** with fields prefilled, **not** Quick deal |
| M5 | AI Compose → pick variant → use | Lands on **AI ads** with copy + poster path when returned |
| M6 | AI ads: generate 3 variants | Cards show **Published preview**, **full listing** block, taller image when photo exists; placeholder when no photo |
| M7 | AI ads: select ad, publish | `composeListingDescription` used; quality + DB insert consistent |

### 4.3 Keyboard & scroll

| # | Steps | Expected |
|---|--------|----------|
| M8 | Quick deal: focus multiline **Offer hint**, keyboard open | Field remains visible or scrollable; can read typed text |
| M9 | AI ads: focus bottom **Details** / **Publish** area | Same |
| M10 | Home tab: focus **search** | List/header scrolls; search not covered |
| M11 | Account (logged out): email + password | Form scrolls above keyboard |
| M12 | Redeem → **Manual** → code field | Scroll + keyboard OK |
| M13 | Settings → ZIP field (zip mode) | OK |

### 4.4 Regressions (smoke)

| # | Steps | Expected |
|---|--------|----------|
| M14 | Open deal from **template** (`templateId`) on AI screen | Template load still wins; prefill params do not overwrite incorrectly |
| M15 | Auth landing login | Still works; keyboard usable |
| M16 | Onboarding ZIP step | Keyboard OK |

---

## 5. Findings summary

| ID | Severity | Title | Status |
|----|----------|--------|--------|
| AUTO-01 | Info | Full vitest + tsc green | **Closed** (automated) |
| AUTO-02 | Info | `keyboard-screen` eslint duplicate import | **Closed** (fixed) |
| ENV-01 | Blocker for device QA | No Android device for agent-device | **Open** — run matrix §4 on emulator |

**No functional defects were observed in automated tests.** Runtime UX (keyboard, navigation) **requires** manual execution of §4.

---

## 6. How to re-run automation

```bash
cd /path/to/twoforone
npm install
npx vitest run
npx tsc --noEmit
npx expo lint
```

## 7. How to attach device QA later

1. Start Android emulator or connect device; install/run the app (`npx expo start`, press `a`).
2. Work through §4; record Pass/Fail in a copy of this file or your tracker.
3. Optional: with a booted device, `npx agent-device open <package> --platform android --session qa` then dogfood per `.agents/skills/dogfood/SKILL.md`.
