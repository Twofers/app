# Android Business Account UX Pass - 2026-06-14

Scope: Android emulator QA of the business account screens using the installed `com.unvmex2.twoforone` app. No code changes, builds, releases, migrations, publishing, deleting, AI generation, photo picking, printing/exporting, sign-out, or account deletion were performed.

Screenshots: `00-login.png` through `48-business-setup-create-business-button.png` in this folder.

Detailed future-reference report: `BUSINESS_ACCOUNT_UX_DETAILED_REPORT.md`.

## Coverage

- Login and owner PIN gate.
- Redeem tab: locked state, camera permission state, manual ticket-code fallback, Android camera permission dialog, active scanner.
- Create tab: hub, quick deal, AI ad form, claim settings, reuse, menu offer, scan menu, menu library, templates.
- My Offers: dashboard metrics, filters/sorts, deal cards, manage sheet, analytics, edit-deal entry.
- Account: support, profile summary, language, notifications, redemption mode, business profile fields, advanced/legal/delete area.
- Business setup page via app deep link.

## Not Exercised

- Actual QR/token redemption, because that would require a customer code.
- Photo picker/camera capture uploads and AI generation, to avoid media/AI side effects.
- Publishing, duplicating, printing/exporting, deleting, sign out, or account deletion.
- Changing language, notification switches, PIN settings, redemption device state, or profile data.

## UX Findings

1. High: Deal Analytics is a dead end on Android.
   - From My Offers, tapping a deal opens Deal Analytics.
   - The screen showed no visible back control, and Android Back did not return to My Offers.
   - I had to force-stop/reopen the app to continue QA.
   - Screenshot: `26-deal-analytics-empty.png`.

2. High: Camera permission flow bounced out of the app and lost the owner unlock.
   - Tapping Grant permission showed the Android camera permission dialog.
   - After choosing while-using permission, the emulator returned to the Android launcher.
   - Reopening Twofer landed back on the owner PIN gate, requiring another unlock before the scanner could be used.
   - Screenshots: `04-android-camera-permission-dialog.png`, `05-redeem-scan-camera.png`.

3. High: Redemption Mode setup displayed a PIN value in the exit-PIN field.
   - The device setup area contained a pre-filled PIN value. I did not save the raw screenshot; `35-account-redemption-device-setup-redacted.png` redacts the field.
   - This is risky because PINs should not appear as reusable visible/default field state.

4. Medium: Edit Deal prompts to discard changes even when no edit was made.
   - I opened Edit Deal from Analytics and immediately tapped back.
   - The app showed "Discard changes?" despite no intentional field change.
   - Screenshot: `28-edit-deal-discard-prompt.png`.

5. Medium: Quick Deal "More options" behaves like navigation.
   - On Quick Deal, tapping "More options" opened the full AI Ads route instead of expanding inline options.
   - The label reads like an expander, not a route change.
   - Screenshots: `07-create-quick-deal.png`, `08-create-ai-ads-start.png`.

6. Medium: Business profile summary contradicts completion hint.
   - Account summary showed a category line, but also said the profile was 50% complete and prompted to add a category.
   - Screenshot: `29-account-top-profile-support.png`.

7. Medium: Business setup edit path uses create-language.
   - Opening the existing business profile setup screen ends with a "Create business" button.
   - For an existing business profile, this can feel like creating a duplicate instead of saving edits.
   - Screenshot: `48-business-setup-create-business-button.png`.

8. Low/Medium: Create-from-menu has an extra one-location selection step.
   - v1 businesses are capped at one location, but the menu offer flow still asks to select the only location and tap Next.
   - Screenshots: `14-create-menu-offer-location.png`, `15-create-menu-offer-empty.png`.

9. Low/Medium: Scan Menu empty state appears before any scan in this session.
   - The screen showed "No items found. Try a clearer photo..." alongside first-use menu-scan actions.
   - Screenshot: `16-create-scan-menu-empty.png`.

10. Low: Some business controls have unlabeled switches in the accessibility dump.
    - Deal alerts and Business notifications appeared as unlabeled switches.
    - Screenshot: `30-account-profile-language-notifications.png`.

11. Low: Expanded templates start under the tab bar.
    - Opening Templates on the Create hub required scrolling because expanded content began beneath the bottom navigation area.
    - Screenshots: `20-create-templates-expanded-top.png`, `21-create-templates-expanded-card.png`.
