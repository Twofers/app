# TWOFER Local Android RC Handoff - 2026-06-07

## 1. Executive summary

Status: Local Android RC validated.

Android emulator/local debug validation passed for the current local checkpoint. The app is not store-ready, not Play production-ready, and not iOS-ready. Android real-device or Play Internal Testing remains pending. iOS TestFlight remains pending. Store submission remains blocked by store-readiness items.

This checkpoint documents the validated local Android debug/dev-client state only. It should be used as a handoff point for continued QA and later release artifact preparation, not as a claim of production or store readiness.

## 2. Current branch, HEAD, and local tag

- Branch: `fix/current-app-with-share-isolated`
- HEAD: `5bdff9e Handle location onboarding denial safely`
- Full HEAD: `5bdff9e992f89ac897f208bf3c94974b63eca6b4`
- Local Git tag: `local-android-rc-validated-20260607`
- Tag note: local validation checkpoint tag only; do not treat it as a pushed release tag.

## 3. Important commit chain

Recent local chain at validation time:

```text
5bdff9e Handle location onboarding denial safely
1c72fe0 Align store review wording
4aca25e Fix account deletion discoverability
ed96cfd Fix business setup back navigation
7e0a3c3 Fix deal detail back navigation
e2bad50 Wire Firebase config into native Android project
9501527 Enable Share Deal for dev client build
027376f Tighten EAS ignore for build artifacts
6a008a1 Add EAS ignore for local QA artifacts
300aecb Render haptic tab button via component wrapper
7a7c14a Clamp synced consumer alert radius
a995c81 Wire Android Firebase push config
```

The local tag `local-android-rc-validated-20260607` points to `5bdff9e`.

## 4. What was validated locally

- Local Android debug build existed and was installed on the emulator.
- Native Firebase wiring compiled locally.
- Metro/dev-client runtime loaded the app from the local project.
- `EXPO_PUBLIC_ENABLE_SHARE_DEAL=true` was used for the Share Deal QA pass.
- Tracked worktree was clean after validation.
- Remaining untracked QA/docs artifacts were local artifacts and should not be treated as app source changes.

## 5. What was validated on emulator

Validated on Android emulator with package `com.unvmex2.twoforone`:

- App launched through the installed dev-client/debug package.
- App foregrounded without immediate crash.
- No launcher return was observed during the final validated pass.
- No blank surface was observed during the final validated pass.
- No obvious React dev overlay was observed during the final validated pass.
- Customer feed loaded.
- Business Dashboard loaded.

## 6. Firebase/notification status

Native Firebase wiring compiled locally and Firebase push token registration passed locally.

Observed validation:

- Notification permission prompt appeared.
- Notification permission was granted for the local emulator pass.
- Deal Alerts were enabled for the demo validation account.
- Sanitized backend check confirmed Android push token rows existed/updated for the validated user.
- No push token, auth token, Supabase key, private user data, QR token, claim code, or redemption code should be copied into this document or future handoffs.

Controlled push delivery final proof remains pending unless separately documented.

## 7. Share Deal status

Share Deal passed with `EXPO_PUBLIC_ENABLE_SHARE_DEAL=true`.

Observed validation:

- Share Deal button was visible on deal detail.
- Android native share sheet opened.
- Shared URL matched the expected public short-link shape: `https://www.twoferapp.com/s/<7-char-code>`.
- Public page returned HTTP 200.
- Public page showed: "You've been sent a TWOFER deal."
- Public page showed: "Open TWOFER to claim or redeem this offer."
- No QR tokens, redemption codes, auth tokens, claim codes, or private user data were exposed in the shared text or public page during the validated pass.

## 8. Account deletion status

Account deletion discoverability passed.

Observed validation:

- Consumer Settings exposed "Delete my account".
- The destructive confirmation prompt was clear.
- The destructive action was not executed.
- The confirmation was canceled.

## 9. Navigation fixes status

Validated navigation fixes:

- Deal detail visible back affordance returned to feed/home.
- Android Back from deal detail returned to feed/home.
- No launcher return was observed during the final validated navigation pass.

Business setup back navigation was previously fixed in the commit chain, but the final runtime account went directly into existing business mode. The invite-code/setup gate was not re-entered in the final local pass.

## 10. AI Draft status

Business Dashboard loaded and AI Draft reached the review screen.

Observed validation:

- Existing demo business mode loaded.
- Quick Deal / AI Draft flow reached "Review & publish".
- No real deal was published.
- The AI Draft flow may have created a demo draft asset in hosted storage as part of the review-screen generation path.

## 11. Location denial status

Location denial fallback passed.

Observed validation:

- Current-location unavailable/denied flow displayed a friendly fallback message.
- The app did not crash.
- The app did not return to launcher.
- The app did not show a blank surface.
- User remained in an app-controlled flow with ZIP/fallback path available.

## 12. What remains unvalidated

- Android real-device or Play Internal Testing remains pending.
- iOS TestFlight remains pending.
- Controlled push delivery final proof remains pending unless separately documented.
- Production signed artifact behavior remains pending.
- Store listing, store policy, and store-readiness checks remain pending unless separately documented.
- Full cross-device regression remains pending.
- Final native Firebase behavior should be rechecked on the later shareable/internal build artifact.

## 13. Store blockers still open

Store submission remains blocked by store-readiness items.

Known remaining blockers or gates:

- This is not store-ready.
- This is not Play production-ready.
- This is not iOS-ready.
- Android real-device or Play Internal Testing remains pending.
- iOS TestFlight remains pending.
- Controlled push delivery final proof remains pending unless separately documented.
- A shareable EAS/internal build artifact has not been validated in this checkpoint.
- Store metadata, review assets, policy/legal readiness, and release-process checks still need final validation before submission.

## 14. Known local artifacts/untracked folders

At the checkpoint, tracked source was clean, while local untracked QA/docs artifacts remained present. These should not be treated as app source changes and should not be deleted as part of this handoff.

Known untracked local artifacts included:

```text
codex-release-fix-prompt.txt
docs/store-release-prep.md
meeting minutes/
notification_emulator_20260607/
setup-local-build.ps1
share_deal_manual_on_20260606/
share_deal_smoke_20260606/
share_deal_smoke_20260606_rerun/
twofer_rc_qa_20260607/
```

## 15. Exact next recommended paths

### Continue local emulator QA

Use the current branch and local Metro/dev-client flow for focused emulator QA. Do not use emulator success alone as store readiness proof.

Recommended path:

1. Confirm clean tracked worktree.
2. Start Metro with Share Deal enabled.
3. Launch the installed dev-client/debug app.
4. Re-run only the focused scenario under test.
5. Record results without printing secrets, tokens, QR tokens, claim codes, redemption codes, or private user data.

### Run controlled push delivery

Controlled push delivery remains pending.

Recommended path:

1. Establish a single controlled test recipient.
2. Confirm the recipient is not a real customer audience.
3. Trigger only the controlled test notification path.
4. Record delivery result without printing push tokens, auth tokens, or private user data.

### Create a shareable EAS/internal build later

A future EAS build should be saved for a shareable artifact or Play Internal Testing, not more local emulator proof.

Recommended path:

1. Keep local emulator validation as the preflight.
2. Build only when the target is a shareable/internal artifact.
3. Validate install, launch, Firebase initialization, notifications, and Share Deal on that artifact.

### Prepare Play Internal Testing

Recommended path:

1. Create the Android internal testing artifact when ready.
2. Validate on at least one real Android device.
3. Confirm push registration and controlled push delivery on the internal testing artifact.
4. Confirm Play listing, screenshots, policies, and test instructions are ready.

### Prepare iOS TestFlight

Recommended path:

1. Confirm iOS-specific config and native build requirements.
2. Create TestFlight artifact when ready.
3. Validate auth, feed, deal detail, Share Deal, account deletion discoverability, notifications, and AI Draft on iOS.
4. Keep iOS readiness separate from this Android emulator/local debug checkpoint.

## 16. Commands to restore this checkpoint later

Restore the branch:

```powershell
cd C:\Users\unvme\Downloads\twoforone
git switch fix/current-app-with-share-isolated
git status --short --branch
```

Inspect the local checkpoint tag:

```powershell
cd C:\Users\unvme\Downloads\twoforone
git show --stat local-android-rc-validated-20260607
```

Check out the exact tagged commit in detached mode only if needed:

```powershell
cd C:\Users\unvme\Downloads\twoforone
git checkout --detach local-android-rc-validated-20260607
```

Return to the working branch after detached inspection:

```powershell
cd C:\Users\unvme\Downloads\twoforone
git switch fix/current-app-with-share-isolated
```

## 17. Commands to run local debug build again

Run only when a local native rebuild is actually needed:

```powershell
cd C:\Users\unvme\Downloads\twoforone
npx expo run:android
```

If installing an already-built local debug APK is enough:

```powershell
cd C:\Users\unvme\Downloads\twoforone
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

## 18. Commands to run Metro with Share Deal enabled

Use this for local dev-client QA:

```powershell
cd C:\Users\unvme\Downloads\twoforone
$env:EXPO_PUBLIC_ENABLE_SHARE_DEAL="true"
npx expo start --dev-client --port 8081
```

Open the running Metro/dev-client URL in the Android emulator:

```powershell
adb shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:8081"
```

Or launch the installed app package:

```powershell
adb shell monkey -p com.unvmex2.twoforone -c android.intent.category.LAUNCHER 1
```

## 19. Commands to run future EAS dev-client build only when needed

Do not run EAS build for more local emulator proof. Save EAS for a shareable/internal artifact or Play Internal Testing.

Future Android dev-client/internal build command, only when needed:

```powershell
cd C:\Users\unvme\Downloads\twoforone
npx eas build --profile development --platform android
```

Future Android internal/release-track artifact command should use the project's approved release profile only after store-readiness items are complete and config is reviewed. Do not change signing, package IDs, bundle IDs, EAS profiles, credentials, or release config as part of this checkpoint.

## 20. Safety notes

- Local Android RC validated.
- Android emulator/local debug validation passed.
- Android real-device or Play Internal Testing remains pending.
- iOS TestFlight remains pending.
- Store submission remains blocked by store-readiness items.
- This is not store-ready.
- This is not Play production-ready.
- This is not iOS-ready.
- Controlled push delivery final proof remains pending unless separately documented.
- A future EAS build should be saved for a shareable artifact or Play Internal Testing, not more local emulator proof.
- Do not print secrets, Supabase keys, auth tokens, push tokens, full Firebase config contents, QR tokens, claim codes, redemption codes, or private user data in future QA notes.
- Do not delete local QA artifacts unless explicitly asked.
- Do not treat local emulator validation as production launch approval.
