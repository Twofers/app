# Customer Account QA Recheck - 2026-06-15

Branch: `codex/customer-account-qa-fixes`
Commit tested: `87279d1`
Runtime tested: Android emulator dev-client bundle on Pixel-class emulator.

## Fixed / Passing In Recheck

- Login/account role: customer session routes into the shopper experience; consumer Settings no longer shows App mode or business switching controls.
- Settings/Profile navigation: Settings > Shopper profile supports Android hardware Back back to Settings.
- Settings form state: Save ZIP is disabled when the saved five-digit ZIP is unchanged.
- Birthday picker: Android now uses the themed Twofer modal with month/day/year steppers and Clear.
- Distances: customer Home displays positive mileage such as `6.9 mi away`; no negative distance was observed.
- Deal details: demo/sample deal is read-only with no Claim or Refresh QR actions; fine print uses customer-facing copy.
- Detail headers/placeholders: business and deal detail headers now use specific names/titles where available, with improved fallback visuals.
- Report sheet: bottom actions have additional gesture-navigation clearance.
- Map markers: business markers are visible after the native camera fit, and tapping a marker opens the bottom detail card with View deal / View shop actions.
- Automated checks: `npx tsc --noEmit`, `npx vitest run`, `npx expo lint`, and Android Metro export all passed.

## Still Needs Data / Handoff

- Full claim-to-QR-to-wallet validation still needs a live claimable non-demo QA deal for this customer account. The local seed template was updated for separate merchant/customer QA accounts, but no Supabase seed or migration was applied.
- Share Deal on an actually live claimable deal could not be manually verified with the current visible demo-only data. The feature flag is enabled and the existing code path remains available for live deal details.
- A fresh Android APK was not built because release/build work is a repo hard gate. This pass used the local Android dev-client bundle.

## Smoke Notes

- Focused emulator smoke covered Home, deal detail, Settings, profile edit, themed birthday modal, and Map marker press.
- A filtered stability recheck after opening the map marker card showed the app process still running and no app fatal JavaScript/native crash in the observed interval. AndroidRuntime noise seen during the run came from UIAutomator helper commands, not the app process.
