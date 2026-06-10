# Map Reliability + Menu-First Deal Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make map behavior more reliable with stronger live-deal emphasis, and reduce business-side typing in the menu-to-deal flow.

**Architecture:** Keep existing screen structure and introduce focused helper functions for reliability and menu-prefill behavior. Use incremental UI updates in map and create flow while preserving strong-deal guardrails and current routing constraints.

**Tech Stack:** Expo React Native, TypeScript, Supabase, react-native-maps, Vitest.

---

### Task 1: Reliable map business loading and filtering

**Files:**
- Create: `lib/map-businesses.ts`
- Modify: `components/map/map-native-screen.tsx`
- Test: `lib/map-businesses.test.ts`

- [ ] **Step 1: Write failing tests for map business paging/filtering**

Add tests for:
- collecting all pages until exhausted
- dropping invalid coordinates
- handling duplicate business IDs safely

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/map-businesses.test.ts`
Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement minimal helper**

Create helper that:
- fetches paged businesses from Supabase
- de-duplicates by `id`
- validates coordinates
- returns normalized marker-ready businesses

- [ ] **Step 4: Integrate helper into map screen**

Update map screen data load to:
- fetch all businesses through helper (not single `.limit(400)`)
- keep previous marker/deal data on transient fetch error (avoid empty-map regression)
- preserve existing “all/live” toggles

- [ ] **Step 5: Run map helper tests**

Run: `npm test lib/map-businesses.test.ts`
Expected: PASS.

---

### Task 2: Clear live-deal visual emphasis tuning

**Files:**
- Modify: `components/map/live-deal-halo.tsx`
- Modify: `components/map/map-native-screen.tsx`
- Test: `lib/map-businesses.test.ts` (no new UI test harness in repo; keep behavioral guard at helper level)

- [ ] **Step 1: Add visual-tuning expectation via targeted test**

Add/extend helper test for live-business IDs presence derivation (used by map visuals).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/map-businesses.test.ts`
Expected: FAIL before new helper behavior is added.

- [ ] **Step 3: Implement minimal visual emphasis refinement**

Tune halos and marker styling for live deals:
- stronger blue pulse values
- keep marker icon differentiation and selected-state behavior
- avoid breaking map performance safeguards (`tracksViewChanges={false}` on markers)

- [ ] **Step 4: Run tests**

Run: `npm test lib/map-businesses.test.ts`
Expected: PASS.

---

### Task 3: Menu-first create flow with fewer typing steps

**Files:**
- Create: `lib/menu-offer-prefill.ts`
- Create: `lib/menu-offer-prefill.test.ts`
- Modify: `app/create/menu-offer.tsx`
- Modify: `app/create/quick.tsx`

- [ ] **Step 1: Write failing tests for menu-offer quick prefill builder**

Add tests for:
- composing prefill title + hint from selected ad
- trimming whitespace
- preserving CTA/body text order

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test lib/menu-offer-prefill.test.ts`
Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement minimal prefill helper**

Create helper that converts selected generated ad into `quick` route params with sane defaults.

- [ ] **Step 4: Wire menu-offer to quick publish path**

Replace route from menu-offer ad selection to `/create/quick` using helper params, including `fromMenuOffer`.

- [ ] **Step 5: Reduce typing in quick form for menu-origin deals**

In quick screen:
- auto-apply prefilled location if provided
- add tap presets for max claims and cutoff minutes
- keep manual fields available as fallback

- [ ] **Step 6: Run tests**

Run: `npm test lib/menu-offer-prefill.test.ts`
Expected: PASS.

---

### Task 4: Verification sweep

**Files:**
- Modify: `components/map/map-native-screen.tsx` (if lint/type fixes needed)
- Modify: `app/create/quick.tsx` (if lint/type fixes needed)

- [ ] **Step 1: Run focused tests**

Run: `npm test lib/map-businesses.test.ts lib/menu-offer-prefill.test.ts`
Expected: PASS.

- [ ] **Step 2: Run broader quality checks**

Run: `npm run test`
Expected: PASS (or report exact failing suites with reasons).

- [ ] **Step 3: Run app startup verification**

Run: `npx expo start --offline`
Expected: Metro starts successfully and project boots.

- [ ] **Step 4: Manual validation checklist**

- Map shows all businesses with valid coordinates (not capped to first 400)
- Live businesses have obvious pulsing blue halo/glow
- Menu-offer ad selection lands in quick publish with prefilled content
- Quick form can publish with fewer typed fields (preset taps)
