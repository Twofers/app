# Map Screen Audit Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize map behavior, ensure all mappable businesses are shown, make live deals visually obvious, and make marker taps route to the right destination.

**Architecture:** Keep map screen structure intact and strengthen reliability by moving route/selection logic into tested helpers. Preserve marker rendering performance (`tracksViewChanges={false}`) while improving live halo visibility and tap intent.

**Tech Stack:** Expo React Native, TypeScript, react-native-maps, Vitest.

---

### Task 1: Stability-first helper behavior

**Files:**
- Modify: `lib/map-businesses.ts`
- Test: `lib/map-businesses.test.ts`

- [ ] **Step 1: Write failing test for preview deal selection**
- [ ] **Step 2: Run `npm test -- lib/map-businesses.test.ts` and confirm failure**
- [ ] **Step 3: Implement `pickPreviewDeal` with live-first + earliest-end fallback**
- [ ] **Step 4: Re-run tests and confirm pass**

---

### Task 2: Deterministic map tap routing

**Files:**
- Modify: `lib/map-businesses.ts`
- Modify: `components/map/map-native-screen.tsx`
- Test: `lib/map-businesses.test.ts`

- [ ] **Step 1: Write failing test for map tap href resolution**
- [ ] **Step 2: Run test and verify red state**
- [ ] **Step 3: Implement `resolveMapTapHref` helper**
- [ ] **Step 4: Wire marker `onPress` to route deal/business target**
- [ ] **Step 5: Re-run tests and confirm pass**

---

### Task 3: Stronger live marker emphasis

**Files:**
- Modify: `components/map/live-deal-halo.tsx`

- [ ] **Step 1: Increase halo radius and contrast for live deals**
- [ ] **Step 2: Keep animations map-native and low-overhead**
- [ ] **Step 3: Verify no lints and no map rendering regressions**

---

### Task 4: Verification

**Files:**
- Modify: `components/map/map-native-screen.tsx` (if follow-up fixes needed)

- [ ] **Step 1: Run focused unit tests**
  - `npm test -- lib/map-businesses.test.ts`
- [ ] **Step 2: Run lint diagnostics for touched files**
- [ ] **Step 3: Start app**
  - `npx expo start --offline --port 8084`
- [ ] **Step 4: Manual checks**
  - All valid-coordinate businesses appear in `all` mode.
  - Live businesses show pronounced pulsing blue halos.
  - Tapping a live business marker opens deal detail.
  - Tapping a non-live marker opens business profile.
