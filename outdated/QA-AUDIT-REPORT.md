# TWOFER QA Audit Report

**Date:** 2026-04-07
**Test suite:** 23 files, 157 tests — all passing
**Orientation:** Locked to portrait (app.json) — correct
**Emulator:** Android (bundling observed during session)

---

## CRITICAL — Fix Before Launch

### C1. QR Modal Memory Leak — Nested setTimeout Can Fire After Unmount
**File:** `components/qr-modal.tsx:166`
**What:** Inside the toast animation effect, a nested `setTimeout(() => setToastVisible(false), 220)` at line 166 is NOT stored in a ref. The outer timeout (line 163) is tracked via `toastTimerRef` and cleaned up on unmount (lines 169-172), but the inner one has no cancel path. If the modal unmounts during the 220ms window, React will warn about setting state on an unmounted component, and on older RN versions this leaks.
**Fix:** Store the inner timeout ID in a second ref (e.g., `toastHideRef`), and clear it in the same cleanup block at lines 169-172.

### C2. Account Form Inputs Stay Editable During Save
**File:** `app/(tabs)/account.tsx:886-1137`
**What:** The save button disables via `disabled={savingProfile}` (line 1161), but all 12+ TextInput fields (lines 886-1137) do NOT set `editable={!savingProfile}`. Users can change values mid-save, causing the saved data to diverge from what's on screen.
**Fix:** Add `editable={!savingProfile}` to every TextInput in the business profile form.

### C3. Dashboard Has No Error Boundary
**File:** `app/(tabs)/dashboard.tsx`
**What:** The dashboard screen has no `<AppErrorBoundary>` or local error boundary wrapping it. A JS error in analytics aggregation (e.g., null pointer on unexpected API response) will crash the entire tab navigator, requiring an app restart.
**Fix:** Wrap the dashboard content in `<AppErrorBoundary>` (already used in root layout, so the pattern exists).

---

## HIGH — Significant UX or Reliability Issues

### H1. No Image Loading Placeholders
**File:** `components/deal-card-poster.tsx:92-97`
**What:** The `<Image>` component has `transition={300}` but no `placeholder` prop. While posters load, users see a blank white space. On slow connections this looks broken.
**Fix:** Add a `placeholder` prop with a blurhash string or a lightweight solid-color placeholder. Example: `placeholder={{ blurhash: "L6PZfSi_.AyE_3t7t7R**0o#DgR4" }}`.

### H2. Penguin Hero Image Overflows Small Screens
**File:** `app/auth-landing.tsx:316`
**What:** Container is hardcoded `width: 360, height: 220`. On devices narrower than 360 logical px (some Android phones), the image overflows and gets clipped by the parent.
**Fix:** Change to `maxWidth: "85%", aspectRatio: 360/220` and let `alignSelf: "center"` handle centering.

### H3. No Client-Side Email Format Validation
**File:** `app/auth-landing.tsx:497-517`
**What:** The email TextInput has `keyboardType="email-address"` but no format validation before submission. Invalid emails are sent to Supabase, which returns a generic auth error. Users don't know why signup failed.
**Fix:** Add a simple regex check (`/^\S+@\S+\.\S+$/`) on blur or submit. Show an inline error message below the input.

### H4. Android DateTime Picker — Complex Two-Step State
**File:** `app/create/ai.tsx:297-300`
**What:** Android doesn't support a combined date+time picker, so the code uses a two-step flow with `androidStartPickerMode` state. The state transitions are intricate and could produce unexpected behavior if the user dismisses the picker mid-flow.
**Fix:** Consider using `@react-native-community/datetimepicker` with `mode="datetime"` on Android 14+ where it's supported, or simplify the state machine with an explicit finite-state enum.

### H5. Hardcoded English Strings in i18n `defaultValue`
**Files:**
- `app/(tabs)/billing.tsx:231` — `"Your trial has ended. Reactivate your account to continue creating deals."`
- `app/(tabs)/billing.tsx:325` — `"Your free trial has ended"`
- `app/(tabs)/billing.tsx:329` — `"Your 30-day trial ends in {{days}} days"`
- `app/(tabs)/create.tsx:114` — same trial-ended message
**What:** These `defaultValue` strings are English-only fallbacks. If the i18n key is missing in Spanish/Korean, users see English text in an otherwise translated UI.
**Fix:** Ensure all keys exist in `es.json` and `ko.json`. Remove the `defaultValue` props or set them to empty so missing translations are caught during development.

### H6. Muted Text Contrast May Fail WCAG AA
**File:** `constants/theme.ts`
**What:** Muted text uses `opacity: 0.62` on top of the text color. In dark mode this could produce contrast ratios below WCAG AA (4.5:1 for normal text). Affected: captions, secondary labels, placeholder text.
**Fix:** Bump muted text opacity to `0.72` minimum, or use an explicit color value (e.g., `#9ca3af`) that guarantees sufficient contrast against both light and dark backgrounds.

---

## MEDIUM — UX Polish and Maintainability

### M1. Inconsistent Loading Indicators
**Where:** Feed uses `LoadingSkeleton`, create screen uses `ActivityIndicator`, dashboard uses inline spinner.
**Fix:** Standardize: use `LoadingSkeleton` for initial data loads, `ActivityIndicator` only for in-progress actions (save, submit).

### M2. Missing `hitSlop` on Small Touch Targets
**Files:** `app/auth-landing.tsx:357-376` (language buttons), `app/(tabs)/account.tsx:824-872` (locale buttons), `app/(tabs)/account.tsx:928-967` (lookup result rows)
**What:** These Pressable components rely on content padding alone for touch area. On some elements the touch target is below the 44px minimum.
**Fix:** Add `hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}` to all small interactive elements.

### M3. No Retry Button in Error Banners
**Where:** Feed, dashboard, billing screens show error banners but most don't pass `onRetry`.
**Fix:** The `Banner` component already supports `onRetry` — pass the data reload function as the handler.

### M4. No `cachePolicy` on Deal Poster Images
**File:** `components/deal-card-poster.tsx:92`
**What:** Expo Image defaults to a reasonable cache, but explicitly setting `cachePolicy="memory-disk"` would ensure posters are aggressively cached.
**Fix:** Add `cachePolicy="memory-disk"` to deal poster `<Image>` components.

### M5. `as any` Type Casts on Supabase Response
**File:** `hooks/use-business.ts:167, 177`
**What:** `bpRow = byUserRow as any` and `bpRow = byOwnerRow as any` suppress TypeScript checks. If the Supabase schema changes (column rename, type change), the app won't catch it at compile time.
**Fix:** Define a `BusinessProfileBilling` type matching the `billingSelect` columns. Replace `as any` with proper type assertion or use `.returns<BusinessProfileBilling>()`.

### M6. Business Profile Image Hardcoded Height
**File:** `app/business/[id].tsx:305`
**What:** `height: 200` is a fixed pixel value. On tablets or wide phones, the image looks squat.
**Fix:** Use `aspectRatio: 16/9` with `width: "100%"` for responsive sizing.

### M7. Keyboard Handling Missing on Account Screen
**File:** `app/(tabs)/account.tsx`
**What:** The account form has 12+ TextInputs but isn't wrapped in `<KeyboardScreen>`. On Android, the keyboard may cover lower inputs.
**Fix:** Wrap the profile edit section with `<KeyboardScreen>` (already used on auth-landing, redeem, etc.).

### M8. Deep Link Handler Priority Undocumented
**File:** `app/_layout.tsx`
**What:** Root layout renders 5+ deep link handlers (auth-recovery, deal, notification, billing, legacy). If a URL matches multiple handlers, behavior is undefined.
**Fix:** Add a comment block documenting handler priority order, or consolidate into a single dispatcher.

### M9. Magic Numbers Throughout Codebase
**Examples:**
- `app/index.tsx` — `8000` (slow load timeout)
- `app/(tabs)/index.tsx` — `60000` (min feed refresh interval)
- `lib/functions.ts` — `45000`, `120000`, `25000` (edge function timeouts)
- `lib/claim-redeem-deadline.ts` — `30` (grace minutes, already a named constant here — good)
**Fix:** Extract remaining magic numbers to named constants in `constants/timing.ts` or similar.

### M10. Missing Accessibility Labels on Interactive Elements
**Files:** `components/deal-card-poster.tsx:88-89` (card press area — has `accessibilityRole="button"` but no `accessibilityLabel`), `app/(tabs)/account.tsx:824+` (language buttons), `app/auth-landing.tsx:357+` (locale selector)
**Fix:** Add descriptive `accessibilityLabel` props. Example: `accessibilityLabel={t("a11y.viewDeal", { title: deal.title })}`.

### M11. Tab Mode Storage Race Condition
**File:** `lib/tab-mode.tsx`
**What:** `setMode()` writes to AsyncStorage and optionally syncs to server. Concurrent calls (e.g., rapid mode toggle) could interleave writes and leave storage/server out of sync. The `skipNextFetch` flag adds complexity.
**Fix:** Add a simple mutex (promise chain) so `setMode` calls are serialized.

---

## LOW — Nice-to-Have Improvements

### L1. No Password Strength Indicator
**File:** `app/auth-landing.tsx`
**Fix:** Add a visual strength meter below the password input (weak/medium/strong based on length + character variety).

### L2. Confetti Animation May Stutter on Low-End Devices
**File:** `components/qr-modal.tsx:87` — 18 particles
**Fix:** Reduce to 10-12 particles, or use `renderToHardwareTextureAndroid` on the container.

### L3. Toast Duration Hardcoded
**File:** `components/qr-modal.tsx:163` — `3000`ms
**Fix:** Extract to a named constant like `TOAST_DISPLAY_MS`.

### L4. Missing Focus Trap in Modals
**Files:** `components/qr-modal.tsx`, `components/deal-preview-modal.tsx`
**What:** `accessibilityViewIsModal` is set, but there's no explicit focus management when the modal opens.
**Fix:** Use `accessible` and `autoFocus` on the first interactive element in each modal.

### L5. No Lat/Lng Bounds Validation in Business Profile
**File:** `app/(tabs)/account.tsx`
**Fix:** Add range checks (latitude: -90 to 90, longitude: -180 to 180) before save.

### L6. Signed Poster URLs Expire After 1 Year
**File:** `lib/deal-poster-url.ts`
**Fix:** Low priority since deals expire much sooner. For long-lived templates, add a URL age check and re-sign on demand.

---

## Positive Findings (No Action Needed)

- All 157 tests pass across 23 test files
- Strong deal guardrail properly duplicated client + server (trigger blocks weak deals)
- RLS policies are comprehensive with subscription gating on all business operations
- Destructive actions (logout, delete account, end deal) all have Alert.alert confirmation dialogs
- Map screen properly wrapped in `<MapErrorBoundary>`
- Home feed FlatList has `removeClippedSubviews={Platform.OS === "android"}`
- App locked to portrait orientation in `app.json`
- Auth tokens stored in platform-appropriate secure storage
- Demo account bypass properly gated behind `__DEV__`
- No hardcoded API keys or credentials anywhere in the codebase
- Clean separation of auth gates, route protection, and role-based navigation
- Proper cleanup functions in most useEffect hooks
- i18n setup with 3 languages (en/es/ko) and proper fallback chain

---

## Summary

| Severity | Count | Key Theme |
|----------|-------|-----------|
| **Critical** | 3 | Memory leak, form safety, crash resilience |
| **High** | 6 | Missing polish, i18n gaps, accessibility |
| **Medium** | 11 | Consistency, type safety, UX standards |
| **Low** | 6 | Nice-to-have refinements |
| **Total** | **26** | |

### Recommended Fix Order
1. **C1-C3** first (crash/data bugs)
2. **H1-H3** next (most visible user-facing issues)
3. **H5** (i18n gaps — critical for Spanish/Korean users)
4. **M2, M5, M7** (quick wins with high impact)
5. Rest as time allows
