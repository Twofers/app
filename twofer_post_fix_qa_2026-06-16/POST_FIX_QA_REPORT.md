# Twofer Post-Fix QA Report

Date: 2026-06-16
APK tested: `android/app/build/outputs/apk/release/app-release.apk`
Embedded app config: version `1.0.0`, Android versionCode `12`, git commit `b8ea97d`

## Result

Overall result: PASS for the rebuilt APK on the original AI draft-photo recovery blocker.

## Verification

- APK installed successfully over the previous release build.
- Embedded APK config confirms `gitCommit` is `b8ea97d`.
- Repo HEAD during QA was `b8ea97d` on `codex/fix-owner-deal-reuse`.
- Pre-rebuild code checks already passed after the fix: `npx tsc --noEmit`, targeted tests, full `npm test`, `npm run lint`, and Android Metro export probe.

## Owner QA

- Owner login passed after clean app data reset.
- Create surface loaded for the business owner.
- AI photo picker selected the local gallery test image.
- Gallery photo defaulted to `Used for AI guidance`.
- AI draft recovery prompt appeared after force-stopping and reopening the app.
- Continuing the recovered draft restored both:
  - the selected gallery photo preview
  - the draft note marker text
- The recovered draft was discarded after verification to avoid stale prompts.

Key screenshots:
- `046_rebuilt_gallery_photo_default_guidance_step.png`
- `049_rebuilt_ai_draft_recovery_prompt_step.png`
- `050_rebuilt_ai_draft_recovered_photo_visible_step.png`
- `052_rebuilt_ai_draft_recovered_text_visible_step.png`

## Customer QA

- Customer login passed after clean app data reset.
- Current-location onboarding could not read emulator location, but the app showed a clear fallback message and ZIP onboarding worked.
- ZIP onboarding showed nearby/favorite shop candidates and advanced to customer home.
- Customer home loaded a live deal card with demo labeling.
- Shops tab loaded a general business list; in this data state only Cedar & Bean was visible in the list.
- Map tab loaded in All businesses mode.
- Live deals filter updated header copy and retained the live deal card.
- Map marker/card interaction worked: tapping the map card expanded a deal preview and centered the marker in UI hierarchy.
- Deal detail opened without crash.
- Claim button was available, but claim smoke hit the expected duplicate-active-ticket guard because the customer already had an active wallet deal.
- Wallet opened and showed the active ticket path. Local-only screenshot evidence was captured; redemption details are intentionally not transcribed here.

Key screenshots:
- `057_customer_home_live_deal_loaded_step.png`
- `058_customer_shops_tab_loaded_step.png`
- `059_customer_map_all_businesses_loaded_step.png`
- `060_customer_map_live_filter_markers_step.png`
- `061_customer_map_card_expanded_step.png`
- `062_customer_deal_detail_loaded_step.png`
- `063_customer_claim_button_available_step.png`
- `064_customer_claim_result_step.png`
- `065_customer_wallet_active_ticket_local_only_step.png`

## Notes / Risks

- The Android emulator repeatedly hit low-memory pressure before reboot/cleanup, including System UI / Pixel Launcher ANRs and app exits recorded as `LOW_MEMORY`. After rebooting and stopping heavy Google apps, Twofer remained stable for the owner and customer retests.
- Current-location onboarding failed on this emulator even after setting emulator geo and granting location permissions. ZIP fallback worked, so this is logged as a follow-up for a healthier emulator or real device.
- The rebuilt APK retest focused on the previous blocker and customer smoke. Earlier owner reuse scenarios had already passed on the prior APK that contained the reuse fix; `b8ea97d` only changed AI photo recovery behavior.

