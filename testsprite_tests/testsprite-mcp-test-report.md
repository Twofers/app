# TestSprite MCP Test Report

## 1️⃣ Document Metadata
- **Project Name:** twoforone
- **Date:** 2026-06-08
- **Branch:** ios-agent-fixes
- **Prepared by:** TestSprite MCP, summarized by Codex
- **Scope:** Small local Expo web QA only. Native iOS behavior was not tested.
- **Credits:** 150 before first run, 146 after two TestSprite runs.

## 2️⃣ Requirement Validation Summary

### REQ-SMOKE-001: Initial App Load
- **Test Case:** TS-SMOKE-001 - Initial auth landing smoke test
- **TestSprite Status:** Passed twice
- **Latest Dashboard Result:** https://www.testsprite.com/dashboard/mcp/tests/ad366aee-ba24-42d5-8eed-aeabe31ea256/853c69f3-54ce-48a7-926f-c6f893a859a4
- **Test Code:** `testsprite_tests/TS-SMOKE-001_Initial_auth_landing_smoke_test.py`
- **What TestSprite Actually Verified:** Chromium opened `http://localhost:8099/`, waited for DOM content, confirmed the page URL existed, and did not throw a Playwright/runtime error.
- **Important Limitation:** Even after the PRD and test plan required visible text assertions, TestSprite generated a weak URL-only test. Treat this as a reachability smoke pass, not a strong UI-content pass.

### Local No-Credit Verification: Auth Landing
- **Status:** Passed
- **What Was Verified:** Local Playwright confirmed visible auth landing content: `TWOFER`, `Email`, `Password`, `Log in`, and `Create account`.
- **Finding:** The local web target logs a CORS error when the analytics edge-function call runs from `localhost`.

### Local No-Credit Verification: Onboarding ZIP
- **Status:** Partially passed
- **What Was Verified:** The onboarding ZIP field on the web target has `maxlength=5`, numeric input mode, visible `5-digit ZIP` copy, and no visible ZIP+4 copy.
- **ZIP+4 Probe:** Pasting `75063-1234` left `75063`, so ZIP+4 does not persist in the UI.
- **Limitation:** Native iOS number pad, postal autofill, and `InputAccessoryView` Done behavior cannot be proven by the web target.

### Local No-Credit Verification: Birthday Picker Reachability
- **Status:** Limited
- **What Was Verified:** The consumer profile page and Birthday button are reachable in the web target after demo login.
- **Limitation:** The DateTimePicker widget did not render in Expo Web, so TestSprite/web cannot prove the native iOS bottom-sheet Cancel/Done behavior.

## 3️⃣ Coverage & Matching Metrics

| Requirement | Total TestSprite Tests | Passed | Failed | Strength |
|---|---:|---:|---:|---|
| Initial app load | 2 | 2 | 0 | Weak smoke coverage |

- **TestSprite pass rate:** 100%
- **Meaningful automated coverage:** Limited. TestSprite proved local endpoint reachability, but local Playwright was needed for real visible UI assertions.

## 4️⃣ Key Gaps / Risks

- TestSprite generated weak tests for this Expo web target, ignoring requested visible UI assertions.
- Native iOS ZIP keyboard, Done accessory, postal autofill, and birthday bottom-sheet behavior still need TestFlight on a real iPhone or a TestSprite workflow that accepts a native iOS build.
- Push delivery and universal/deep links also still need real-device TestFlight verification.
- The local web target emits a CORS console error for analytics event ingestion from `localhost`; this may only affect browser QA, but it can make strict web smoke tests noisy.
