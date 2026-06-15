# Twofer Android Business Account UX QA Report

QA run date: June 14, 2026  
Detailed report written: June 15, 2026  
Platform: Android emulator  
App package: `com.unvmex2.twoforone`  
Account type tested: Business account  
Artifact folder: `C:\Users\unvme\Downloads\twoforone\artifacts\android-business-ux-2026-06-14`

## Sensitive Data Handling

This report intentionally does not include the test account password, owner PIN, redemption codes, claim codes, QR values, Supabase values, or any other secret. One screen displayed a prefilled PIN-like value during QA; the raw screen was not saved, and the saved artifact for that state is redacted.

Relevant redacted screenshot:

- `35-account-redemption-device-setup-redacted.png`

## Scope

The goal was to perform a UX pass across the business-account pages in the installed Android app and save screenshots for future review.

Covered areas:

- Login and business owner PIN gate.
- Redeem tab: owner-locked state, camera permission path, manual ticket-code fallback, active scanner.
- Create tab: hub, Quick Deal, AI Ads, claim settings, reuse/repeat flow, menu offer flow, scan menu, menu library, templates.
- My Offers: dashboard, offer list, card actions, manage sheet, analytics, edit deal entry.
- Account: profile summary, support, language, notification toggles, redemption mode, device setup, business profile form, legal/delete area.
- Business setup page reached by app deep link.

Not exercised:

- Actual QR/token redemption.
- Publishing, duplicating, deleting, sign out, account deletion, printing, export, or production-like business actions.
- AI generation, voice/photo upload, camera capture upload, and media picker flows.
- Changing business data, language, notification settings, PIN settings, or redemption-device settings.
- Server-side validation, Supabase RLS behavior, email delivery, or push notification behavior.

## Overall Assessment

The business account surface is broad and mostly reachable, but several flows create avoidable friction for a business owner trying to operate in the app during a live shift. The most important problems are navigation traps, permission handling, sensitive PIN display, and dirty-form behavior. Those issues affect trust because business users are likely to test redemptions, scan codes, check live offer performance, and make quick edits while customers are present.

The Create and Account areas have many capabilities, but some labels and states feel like implementation language rather than owner-facing workflow language. The app would benefit from clearer action labels, better empty states, stronger accessibility labels, and more context-aware UI for the v1 pilot rules.

## Severity Guide

- Critical: likely data loss, security exposure, account lockout, destructive action, or unusable core workflow.
- High: blocks or seriously disrupts a core business workflow.
- Medium: creates confusion, extra work, or a realistic mistake path.
- Low: polish, accessibility, clarity, or efficiency issue that should be improved but does not block the workflow.

## Highest Priority Fixes

1. Add a reliable back path from Deal Analytics.
2. Fix camera permission handling so the app does not bounce to the launcher or lose owner unlock.
3. Never display or prefill sensitive PIN values in visible editable fields.
4. Fix Edit Deal dirty-state tracking so unchanged forms do not show a discard warning.
5. Clarify existing-business setup/save language and profile completion logic.
6. Add accessibility labels to business notification switches and similar controls.

## Detailed Findings

### 1. Deal Analytics Is a Dead End on Android

Severity: High  
Area: My Offers / Deal Analytics  
Evidence: `23-my-offers-deal-list.png`, `26-deal-analytics-empty.png`

Observed behavior:

- From My Offers, tapping a deal card opened the Deal Analytics screen.
- The Deal Analytics screen did not show a visible back button or close action.
- Android Back did not return to the prior My Offers screen during QA.
- I had to force-stop and reopen the app to continue testing other business pages.

Why this matters:

- Analytics is a core business-owner workflow. Owners will naturally tap a live offer to inspect performance.
- A user who cannot navigate back may think the app froze, may force close the app, or may lose confidence in the business dashboard.
- This is especially risky if a business owner is switching between analytics and redemption during service.

Recommended improvement:

- Add a visible header back control on Deal Analytics.
- Ensure Android Back returns to My Offers or the previous route.
- If the route can be opened from multiple sources, preserve the actual previous route instead of hardcoding a destination.

Suggested acceptance check:

- Open My Offers.
- Tap a deal.
- Confirm Deal Analytics appears.
- Tap the visible back control and verify My Offers returns.
- Reopen Deal Analytics.
- Press Android Back and verify My Offers returns.

### 2. Camera Permission Flow Bounced Out of the App and Required Owner Unlock Again

Severity: High  
Area: Redeem / Scanner permission  
Evidence: `02-redeem-scan-permission.png`, `04-android-camera-permission-dialog.png`, `05-redeem-scan-camera.png`

Observed behavior:

- The Redeem scanner required camera permission.
- Tapping the permission action triggered the native Android camera permission dialog.
- After selecting the while-using permission option, the emulator returned to the Android launcher.
- Reopening Twofer brought the user back to the owner PIN gate.
- The scanner could be reached only after unlocking again.

Why this matters:

- Redeeming customer offers is one of the most time-sensitive business workflows.
- A permission flow should feel like a one-time setup step, not like the app crashed or disappeared.
- Requiring owner PIN entry again immediately after a permission approval increases friction and may be frustrating during a customer interaction.

Recommended improvement:

- Verify the camera permission callback and app foreground lifecycle handling.
- After permission is granted, keep the user in the Redeem scanner flow when possible.
- If the app must re-check owner lock after backgrounding, consider a short grace period for native permission dialogs.
- Provide a clear retry path if the camera fails to initialize.

Suggested acceptance check:

- Install fresh app state or clear camera permission.
- Open Redeem scanner.
- Grant camera permission.
- Confirm the app remains foregrounded or returns directly to the scanner.
- Confirm owner PIN is not re-requested solely because of the permission dialog.

### 3. Redemption Mode Device Setup Displayed a Prefilled PIN Value

Severity: High  
Area: Account / Redemption Mode / Device Setup  
Evidence: `34-account-redemption-device-setup-top.png`, `35-account-redemption-device-setup-redacted.png`

Observed behavior:

- In the redemption device setup area, a PIN-related field appeared with a prefilled value.
- The raw value was not saved in the artifact set.
- The saved screenshot for that screen was redacted.

Why this matters:

- PIN values should not appear as normal visible text in editable fields.
- A business owner may use this screen in a public setting or in front of staff.
- Prefilling a sensitive value increases the chance it is exposed in screenshots, screen recordings, support calls, or shoulder-surfing scenarios.

Recommended improvement:

- Do not prefill sensitive PIN fields with the existing value.
- Use blank fields with placeholder text such as "Enter new PIN" and "Confirm new PIN".
- If a current PIN is required, ask for it in a masked secure field.
- Use `secureTextEntry` or equivalent masking for PIN inputs.
- Consider showing only non-sensitive state, such as "PIN set" or "Device exit PIN configured".

Suggested acceptance check:

- Open Account > Redemption Mode > Device Setup.
- Confirm no existing PIN value is visible.
- Confirm PIN fields are masked while typing.
- Confirm screenshots and accessibility dumps do not expose the PIN value.

### 4. Edit Deal Shows a Discard Warning Even When Nothing Was Changed

Severity: Medium  
Area: My Offers / Edit Deal  
Evidence: `27-edit-deal-ai-form.png`, `28-edit-deal-discard-prompt.png`

Observed behavior:

- I opened Edit Deal from the analytics path.
- I immediately attempted to go back without intentionally editing fields.
- The app showed a "Discard changes?" confirmation.

Why this matters:

- False dirty-state warnings train users to ignore important warnings.
- Business owners may worry that simply opening a form changed something.
- This slows down review workflows where an owner opens a deal just to inspect current settings.

Recommended improvement:

- Track dirty state by comparing the current form values to the initial loaded values after hydration is complete.
- Avoid marking the form dirty during initial default-value setup, computed-field hydration, or formatting transforms.
- Only show discard confirmation after a user-initiated field change.

Suggested acceptance check:

- Open Edit Deal.
- Do not change anything.
- Tap Back.
- Confirm the app returns without a discard prompt.
- Reopen Edit Deal.
- Change one field.
- Tap Back.
- Confirm the discard prompt appears.

### 5. Quick Deal "More Options" Behaves Like Navigation Instead of Expansion

Severity: Medium  
Area: Create / Quick Deal / AI Ads  
Evidence: `07-create-quick-deal.png`, `08-create-ai-ads-start.png`

Observed behavior:

- On the Quick Deal screen, the "More options" control appeared to imply inline expansion.
- Tapping it moved to the full AI Ads creation flow.

Why this matters:

- The label sets the expectation that the same screen will reveal more controls.
- A route change can feel surprising when the control does not look like a navigation action.
- Users may think they lost the simpler Quick Deal context.

Recommended improvement:

- If the action is navigation, rename it to something like "Open full ad builder" or "Use AI Ads builder".
- If the intended behavior is expansion, keep the user on Quick Deal and reveal the extra controls inline.
- Consider preserving a clear way back to Quick Deal if the full builder is opened.

Suggested acceptance check:

- Tap the control from Quick Deal.
- Confirm the resulting behavior matches the label.
- Confirm a first-time business owner can predict whether they are expanding the current form or switching tools.

### 6. Business Profile Summary Contradicts the Completion Hint

Severity: Medium  
Area: Account / Business Profile summary  
Evidence: `29-account-top-profile-support.png`

Observed behavior:

- The Account screen showed a business category or category-like line in the profile summary.
- The same section also indicated the profile was only partially complete and prompted the owner to add a category.

Why this matters:

- Contradictory completion guidance makes the owner unsure what is missing.
- Profile completion is a trust signal; if it appears wrong, users may not know whether their public business profile is complete.
- This can cause repeat visits to the profile editor without a clear next action.

Recommended improvement:

- Audit the profile completion calculation and the display fields used by the summary.
- If the stored category is incomplete or not in the expected format, explain the exact missing field.
- If the category is present, remove "add category" from the completion hint.
- Consider making the completion card actionable by deep-linking directly to the missing field.

Suggested acceptance check:

- Test a business profile with category present.
- Confirm the completion hint does not ask for category.
- Test a business profile with no category.
- Confirm the hint accurately asks for category and opens the relevant field.

### 7. Existing Business Setup Ends With "Create Business"

Severity: Medium  
Area: Business setup / Business profile editing  
Evidence: `46-business-setup-top.png`, `47-business-setup-category-hours-legal.png`, `48-business-setup-create-business-button.png`

Observed behavior:

- The business setup page was opened for an account that already has a business profile.
- The bottom action used "Create business" wording.

Why this matters:

- Existing owners may worry that tapping the button creates a duplicate business.
- The app's v1 rule caps pilot businesses to one location, so duplicate-creation language is especially confusing.
- The page appears to serve both setup and edit purposes, but the primary action does not adapt to context.

Recommended improvement:

- Use context-aware action labels:
  - New profile: "Create business".
  - Existing profile: "Save business profile" or "Save changes".
- If a profile already exists, include a subtle status line such as "Editing your business profile".
- Ensure the backend action updates the existing business instead of creating a duplicate.

Suggested acceptance check:

- Open business setup with no business row.
- Confirm the action says "Create business".
- Open business setup with an existing business row.
- Confirm the action says "Save changes" and does not create another business.

### 8. Create-from-Menu Flow Has an Extra Location Selection Step for a One-Location v1 Pilot

Severity: Low/Medium  
Area: Create / Menu Offer  
Evidence: `14-create-menu-offer-location.png`, `15-create-menu-offer-empty.png`

Observed behavior:

- The menu offer flow asked the owner to select a location before continuing.
- The account appears to have only one business location.
- v1 locked decisions say pilot businesses are capped to one location.

Why this matters:

- A required one-option selection adds friction without giving the user meaningful control.
- It makes the app feel more complex than the v1 business model.
- It may imply that multiple locations are supported in v1 when they are not.

Recommended improvement:

- Auto-select the single location when only one exists.
- Skip the location step entirely in v1 if the location count is one.
- Keep the route ready for future multi-location support behind the appropriate future flag or condition.

Suggested acceptance check:

- Open Create > Menu Offer for a one-location business.
- Confirm the app goes directly to menu item selection or offer details.
- Confirm no multi-location language appears in v1 unless there are actually multiple locations.

### 9. Scan Menu Empty State Appears Before Any Scan in the Session

Severity: Low/Medium  
Area: Create / Scan Menu  
Evidence: `16-create-scan-menu-empty.png`

Observed behavior:

- The Scan Menu page showed an empty-result style message saying no items were found or suggesting a clearer photo.
- This appeared before a scan was performed during this QA session.

Why this matters:

- First-use empty states should invite action, not imply failure.
- The current message can make a new user think the app already tried and failed.
- For an AI/photo feature, early confidence is important because owners may be testing whether the app understands their menu.

Recommended improvement:

- Use a first-use state before any scan attempt, such as "Scan a menu to find items".
- Show failure-specific text only after a scan returns no detected items.
- Include a clear primary action for taking or uploading a photo.

Suggested acceptance check:

- Open Scan Menu with no prior scan attempt.
- Confirm the state is instructional, not failure-oriented.
- Run or simulate a failed scan.
- Confirm the no-results guidance appears only after that failure.

### 10. Expanded Templates Content Starts Under the Bottom Tab Bar

Severity: Low  
Area: Create / Templates  
Evidence: `20-create-templates-expanded-top.png`, `21-create-templates-expanded-card.png`

Observed behavior:

- Opening Templates from the Create hub expanded content low enough that the owner had to scroll to see the first template card clearly.
- The expanded content appeared partially constrained by the bottom navigation area.

Why this matters:

- Templates should feel like a fast path.
- If the first useful content is hidden or cramped, the feature feels less discoverable.
- Bottom tab overlap or near-overlap can make users worry the UI is cut off.

Recommended improvement:

- Add sufficient bottom padding to scroll containers that live above the tab bar.
- When expanding a section, scroll the expanded section into a comfortable visible position.
- Consider using a dedicated templates screen if the expanded card list becomes long.

Suggested acceptance check:

- Open Create.
- Expand Templates.
- Confirm the first template card is fully visible or the screen scrolls to it automatically.
- Confirm the bottom navigation does not cover content on common Android viewport sizes.

### 11. Notification Switches Need Better Accessible Labels

Severity: Low  
Area: Account / Profile / Notifications  
Evidence: `30-account-profile-language-notifications.png`

Observed behavior:

- Deal alerts and Business notifications switches appeared in the UI dump as generic switches without sufficiently descriptive labels.

Why this matters:

- Screen reader users need switch labels that explain the setting and the current state.
- Unlabeled switches are also harder to inspect in automated accessibility checks.
- Notification preferences are privacy-adjacent, so users should clearly understand what each switch controls.

Recommended improvement:

- Add explicit accessibility labels and hints to each switch.
- Confirm the label includes the setting name and state.
- Ensure tapping the text label toggles the corresponding switch if that is the platform pattern used elsewhere.

Suggested acceptance check:

- Inspect the screen with Android accessibility tooling.
- Confirm each switch is announced with a useful name, role, and state.
- Confirm there are no duplicate or generic-only switch labels.

### 12. Manual Ticket Code Flow Could Use More Format Guidance

Severity: Low  
Area: Redeem / Manual Code  
Evidence: `03-redeem-ticket-code.png`

Observed behavior:

- The manual ticket-code fallback was reachable.
- The screen provides a code entry path, but the expected code format and next-step behavior could be clearer for a first-time staff user.

Why this matters:

- Manual code entry is the fallback when scanning fails, likely during a customer interaction.
- Staff may need to know whether spaces, dashes, case, or partial codes are accepted.
- Reducing hesitation in this fallback flow protects the redemption experience when the camera path fails.

Recommended improvement:

- Add concise helper text showing the expected code format without exposing real codes.
- Auto-format or normalize input if the backend accepts multiple formats.
- Show a disabled-state reason for the submit button when input is incomplete.

Suggested acceptance check:

- Open manual code entry.
- Confirm helper text explains expected input.
- Enter lowercase/spacing variants if supported and verify normalization.
- Confirm invalid input produces a friendly error without clearing the field.

### 13. Analytics Empty State Needs a Clear Next Action

Severity: Low/Medium  
Area: My Offers / Deal Analytics  
Evidence: `26-deal-analytics-empty.png`

Observed behavior:

- The analytics view displayed an empty or low-data state.
- The page did not provide a strong next action, and the navigation issue made the screen feel especially final.

Why this matters:

- New businesses will often have no analytics yet.
- Empty analytics can make owners think tracking is broken unless the app explains when data appears.
- A clear next action helps owners return to promotion or redemption work.

Recommended improvement:

- Explain when analytics appear, for example after claims, redemptions, or views.
- Add a visible back action.
- Consider a secondary action such as "View offer", "Edit offer", or "Share deal" if relevant to v1.

Suggested acceptance check:

- Open analytics for an offer with no activity.
- Confirm the empty state explains why data is absent.
- Confirm there is a visible next action or navigation path.

### 14. Menu Library Empty and Archived States Are Reachable but Could Be More Action-Oriented

Severity: Low  
Area: Create / Menu Library  
Evidence: `17-create-menu-library-empty.png`, `18-create-menu-library-add-item-form.png`, `19-create-menu-library-archived-empty.png`

Observed behavior:

- The Menu Library empty state was reachable.
- The Add Item form was reachable.
- The Archived view was reachable and empty.

Why this matters:

- Menu Library is likely a foundational business tool for creating menu-based offers.
- Empty states should push the next useful action without adding explanation overload.
- Archived states can be confusing if users do not know how items get archived or restored.

Recommended improvement:

- In the empty state, make "Add item" the dominant action.
- In Archived, explain that archived items will appear there after removal from active library.
- Consider showing a short restore affordance once archived items exist.

Suggested acceptance check:

- Open Menu Library with no active items.
- Confirm the primary action is obvious.
- Open Archived with no items.
- Confirm the empty state explains what archived means.

### 15. Long Business Profile Forms Need Strong Save and Progress Cues

Severity: Low/Medium  
Area: Account / Business Profile  
Evidence: `37-account-business-profile-fields-top.png`, `38-account-business-profile-fields-middle.png`, `39-account-business-profile-fields-lower.png`, `40-account-business-profile-fields-location-start.png`, `41-account-business-profile-map-pin.png`, `42-account-business-profile-description-ai.png`, `43-account-business-profile-save-actions.png`

Observed behavior:

- The business profile editor spans many sections and requires scrolling.
- Save actions appear near the bottom.
- The profile includes business fields, location/map-related content, description/AI-related content, and final actions.

Why this matters:

- Long forms are easy to abandon if users are unsure what is required.
- Owners may make a change near the top and forget to scroll to the bottom to save.
- Business profile data is public-facing, so owners need confidence that changes were saved.

Recommended improvement:

- Consider a sticky save bar after the first edit.
- Clearly mark required and optional fields.
- Show field-level validation before final submit where possible.
- Preserve scroll position after validation errors.
- If AI assistance is available for descriptions, make it clear whether it changes fields immediately or inserts a draft.

Suggested acceptance check:

- Edit a top-of-form field.
- Confirm save affordance remains easy to access.
- Trigger a validation error.
- Confirm the app scrolls to the relevant field and preserves entered values.

### 16. Delete Account Area Is Discoverable, So Confirmation Quality Matters

Severity: Low/Medium  
Area: Account / More Options / Delete Account  
Evidence: `44-account-more-options-legal-delete-start.png`, `45-account-delete-account-button.png`

Observed behavior:

- The delete account entry point is reachable from Account more options.
- The actual destructive deletion was not exercised.

Why this matters:

- Account deletion is high consequence.
- It must be easy to find for policy reasons, but difficult to trigger accidentally.
- Business accounts may have offers, redemptions, and profile data tied to them.

Recommended improvement:

- Confirm deletion requires a clear confirmation step.
- Explain what happens to business profile, offers, redemption history, and account login.
- Ensure the action cannot be triggered by a single accidental tap.
- Consider requiring password re-entry for final deletion.

Suggested acceptance check:

- Tap delete account.
- Confirm a clear, non-destructive confirmation screen or dialog appears.
- Confirm cancellation returns to Account.
- Confirm final deletion cannot happen without explicit confirmation.

### 17. Business Role Flow Appears Operational, but Role-Lock Regression Should Be Tested Separately

Severity: Medium potential risk  
Area: Login / Account routing  
Evidence: `00-login.png`, `01-owner-pin-required.png`

Observed behavior:

- Logging in with the provided business account routed into business-owner surfaces.
- The owner PIN gate appeared as expected for business redemption/admin areas.

Why this matters:

- The repo spec says the hard Shopper/Business role split is a locked v1 decision, but it was previously noted as pending implementation.
- A business account appearing correct in this QA pass does not fully prove role-lock behavior for all accounts.

Recommended improvement:

- Add or run regression checks for:
  - Existing account with a business row routes to Business.
  - Existing account without a business row routes to Customer.
  - Login does not show a role picker.
  - Demo account and demo-switch paths are unreachable when that implementation lands.

Suggested acceptance check:

- Use seeded or controlled accounts for each role state.
- Confirm the role cannot be switched inside the app after login.

### 18. Bottom Navigation and Scroll Containers Need More Systematic Viewport Checks

Severity: Low/Medium potential risk  
Area: Create, Account, My Offers  
Evidence: Multiple screenshots, especially `20-create-templates-expanded-top.png`, `21-create-templates-expanded-card.png`, `43-account-business-profile-save-actions.png`

Observed behavior:

- Long forms and expanded sections rely heavily on vertical scrolling.
- At least one expanded Create section felt close to the bottom tab bar.

Why this matters:

- Android devices vary widely in screen height, gesture navigation, font scaling, and safe-area behavior.
- A screen that is usable on one emulator can be cramped or partially covered on another.

Recommended improvement:

- Check common Android viewport sizes and text scaling settings.
- Add bottom padding equal to the tab bar plus safe area on every scrollable tab screen.
- Verify sticky footers and final actions are not obscured by system navigation.

Suggested acceptance check:

- Test at default font size and large font size.
- Test at least one smaller Android viewport.
- Confirm every final action button can be reached and tapped.

## Positive Notes

- The business tab structure was broadly discoverable: Redeem, Create, My Offers, and Account were all reachable.
- Manual ticket-code fallback exists, which is important when camera scanning fails.
- Create tools are grouped around real business workflows: quick offer, AI ad, reuse, menu offer, scan menu, menu library, and templates.
- Account has support, language, notification, redemption, profile, legal, and delete-account surfaces in expected areas.
- The app did not require release builds, store actions, migrations, or destructive operations for this QA pass.

## Recommended Fix Order

1. Navigation trap: Deal Analytics visible back control and Android Back behavior.
2. Permission flow: camera permission should return to scanner without an owner-lock interruption.
3. Sensitive UI: remove visible/prefilled PIN values from redemption setup.
4. Form state: prevent false dirty prompts in Edit Deal.
5. Existing business copy: use save/update language for existing business profiles.
6. Profile completion: correct category/completion mismatch.
7. Accessibility: label switches and verify screen-reader output.
8. Empty states: improve Scan Menu, Analytics, Menu Library, and Archived states.
9. V1 simplification: skip one-location selection where there is only one location.
10. Layout polish: verify bottom-tab spacing and long-form save access across Android viewports.

## Screenshot Catalog

Login and owner gate:

- `00-login.png`
- `01-owner-pin-required.png`

Redeem:

- `02-redeem-scan-permission.png`
- `03-redeem-ticket-code.png`
- `04-android-camera-permission-dialog.png`
- `05-redeem-scan-camera.png`

Create:

- `06-create-home-tools.png`
- `07-create-quick-deal.png`
- `08-create-ai-ads-start.png`
- `09-create-ai-ads-middle.png`
- `10-create-ai-ads-bottom.png`
- `11-create-ai-claim-settings-expanded.png`
- `12-create-reuse-repeat-top.png`
- `13-create-reuse-repeat-bottom.png`
- `14-create-menu-offer-location.png`
- `15-create-menu-offer-empty.png`
- `16-create-scan-menu-empty.png`
- `17-create-menu-library-empty.png`
- `18-create-menu-library-add-item-form.png`
- `19-create-menu-library-archived-empty.png`
- `20-create-templates-expanded-top.png`
- `21-create-templates-expanded-card.png`

My Offers:

- `22-my-offers-dashboard-top.png`
- `23-my-offers-deal-list.png`
- `24-my-offers-card-actions.png`
- `25-my-offers-manage-sheet.png`
- `26-deal-analytics-empty.png`
- `27-edit-deal-ai-form.png`
- `28-edit-deal-discard-prompt.png`

Account:

- `29-account-top-profile-support.png`
- `30-account-profile-language-notifications.png`
- `31-account-redemption-collapsed-language.png`
- `32-account-redemption-expanded-top.png`
- `33-account-redemption-owner-pin-fields.png`
- `34-account-redemption-device-setup-top.png`
- `35-account-redemption-device-setup-redacted.png`
- `36-account-language-profile-delete-bottom.png`
- `37-account-business-profile-fields-top.png`
- `38-account-business-profile-fields-middle.png`
- `39-account-business-profile-fields-lower.png`
- `40-account-business-profile-fields-location-start.png`
- `41-account-business-profile-map-pin.png`
- `42-account-business-profile-description-ai.png`
- `43-account-business-profile-save-actions.png`
- `44-account-more-options-legal-delete-start.png`
- `45-account-delete-account-button.png`

Business setup:

- `46-business-setup-top.png`
- `47-business-setup-category-hours-legal.png`
- `48-business-setup-create-business-button.png`

## Follow-Up Test Suggestions

- Run the same business-account UX pass after fixes and compare screenshots.
- Add an Android Back regression checklist for every non-tab route.
- Test with large Android font size and a smaller emulator viewport.
- Test a brand-new business account with no offers, no menu items, no profile completion, and no redemption setup.
- Test an established business account with active offers, redemptions, analytics data, menu items, archived menu items, and complete profile data.
- Test a staff-like redemption session where the app is opened, unlocked, used to scan, backgrounded briefly, and reopened.
- Test permission denial and "Don't ask again" camera states.
- Test low-connectivity behavior on Redeem, My Offers, Edit Deal, and Account save actions.

## QA Limitations

This was an exploratory emulator UX pass, not a full regression suite. The pass focused on what could be safely inspected without creating, publishing, deleting, redeeming, changing production-like data, triggering AI generation, or using media upload flows. Findings should be validated against the current codebase and backend behavior before implementation.
