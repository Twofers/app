# TWOFER iOS App Store Submission Plan (iOS first, Google Play later)

Date: 2026-06-07
Source of truth for current state: local Android RC checkpoint (HEAD 5bdff9e, tag local-android-rc-validated-20260607).
Scope change: ship on the Apple App Store first, then Google Play in a later phase.
Purpose: a step by step plan that Codex and Claude can execute to take Twofer to the App Store.

This is not a claim that the app is store ready. It is the path to get there.

Important environment fact: the repos live on Windows (C:\Users\unvme). You cannot build or sign an iOS app locally on Windows. iOS builds must run on EAS cloud, which provides macOS and Xcode. Testing through TestFlight needs a real iPhone or iPad. Plan around both of those from the start.

---

## How to use this document

Each task is written for an AI agent. Every task has an objective, the files or commands involved, a do not list, and an acceptance check. Tasks marked **STOP GATE** require Dan's explicit approval before the action. Items marked **DECISION** need Dan's input before the plan can be made fully specific.

---

## Standing rules for any agent executing this plan

These override any task below. If a task seems to conflict, stop and ask.

1. Do not run a store bound build until a stop gate approves it.
2. Do not submit to App Store Connect or push to TestFlight until a stop gate approves it.
3. Do not bump version or build number unless a stop gate approves the exact values.
4. Do not change signing, bundle identifier, capabilities, entitlements, EAS profiles, or release config except inside a task that is explicitly preparing a build, and only after that task's stop gate.
5. Do not push, merge, tag, or release unless explicitly approved.
6. Do not apply Supabase migrations unless intentionally created and reviewed.
7. Do not print secrets. No Supabase keys, push tokens, auth tokens, the APNs .p8 key, the App Store Connect API key, distribution certificates, provisioning profiles, full google-services.json contents, QR tokens, claim codes, or redemption codes.
8. Do not delete the untracked local QA and docs artifacts from the status without review.
9. Do not claim production or store readiness in any commit, doc, or summary.
10. Keep the working tree clean at each checkpoint. Work on the current branch only. Do not create branches without approval.

---

## Phase 0. Decisions and prerequisites

Most of Phase 0 is Dan's input. The agent can stage anything that does not depend on a decision while waiting.

### DECISION D1. Apple Developer Program account
- Are you enrolled in the Apple Developer Program, which costs 99 dollars a year. If not, enroll first.
- Individual or organization. An organization account needs a D-U-N-S number and takes longer to verify. An individual account is faster but lists your personal name as the seller.
- Note in your favor: Apple has no equivalent of Google's 12 testers for 14 days wall. There is no mandatory multi week beta gate before production. The main wait is App Store review, usually a day or two. That is why iOS first can reach the public store faster than the Google Play personal account path would have.

### DECISION D2. Billing posture for v1
The status flags a conflict. Store copy says "No subscription" but the app has Pro, Premium, and Billing surfaces.
- Pilot only and free: hide or disable Pro, Premium, and Billing for v1. This avoids Apple In App Purchase entirely and lets the copy honestly say there is no charge. Fastest path to approval.
- Live purchases: any in app purchase of digital access must use Apple In App Purchase under guideline 3.1.1. External billing for in app digital goods is a rejection. Apple takes a commission. This adds a real integration workstream.
- Recommendation for v1: pilot only and free, unless live billing must exist at launch.

### DECISION D3. Share Deal in v1
- Ship Share Deal in v1, or hold it for a later release.
- If you ship it and want the share link to open the app on iOS, that needs Associated Domains and an apple-app-site-association file on the website, see Task 2.7. If you skip that, the share link just opens the website, which is fine.

### DECISION D4. Versioning for the first build
- Confirm the marketing version (CFBundleShortVersionString, for example 1.0.0) and the starting build number (CFBundleVersion). Every upload to App Store Connect needs a higher build number. No version change happens without this approval.

### DECISION D5. Sign in with Apple
- Does Twofer offer any third party or social login, for example Google or Facebook sign in through Supabase. If it does, Apple guideline 4.8 requires you to also offer Sign in with Apple. Missing this is a common rejection. If the app only uses email and password, this does not apply.

### DECISION D6. iPad support
- The status notes iPad screenshots are required if ios.supportsTablet stays true. Decide: keep iPad support, which means the app must work well on iPad and you must supply 13 inch iPad screenshots, or set supportsTablet to false for an iPhone only v1 and skip the iPad assets and testing.

### Prerequisites checklist (Dan confirms each)
- Apple Developer Program account active.
- The iOS bundle identifier is decided and will be registered, for example com.unvmex2.twoforone to match Android, or a separate iOS ID.
- A public privacy policy URL is live, reachable with no login.
- A physical iPhone is available to test through TestFlight. An iPad too if D6 keeps iPad support.
- Working demo credentials for a consumer account and a business account for the reviewer.
- An APNs authentication key (.p8) is available, or you are ready to create one, so iOS push can be wired to Firebase project twofer-b64b2.
- A support contact email and contact phone for the listing.

---

## Phase 1. Documentation and handoff checkpoint (mobile repo)

Task 1.1. Create the handoff doc.
- File: `docs/ios-submission-handoff-20260607.md` in the mobile repo.
- Content: current branch, HEAD, tag, what was validated locally on Android, the scope change to iOS first, the open iOS blockers, and the standing rules.
- Do not include secret values.
- Acceptance: file exists, names no secrets, a fresh reader understands the state and the new direction.

Task 1.2. Commit on the current branch `fix/current-app-with-share-isolated`. Do not push, tag, or merge.

---

## Phase 2. Pre build iOS compliance (mobile repo, no store build yet)

Task 2.1. Toolchain and SDK audit. **Possibly the largest task, do this first.**
- Apple requires every App Store Connect upload since April 28, 2026 to be built with Xcode 26 and the iOS 26 SDK. EAS cloud builds use an image with a specific Xcode version, so confirm the EAS image you will use ships Xcode 26.
- That Xcode version requires a recent Expo SDK. Report the current Expo SDK and React Native versions. If the app is on an older Expo SDK that cannot build against iOS 26, the upgrade is a real workstream and may introduce regressions. Flag it before any other iOS work.
- Do not start the SDK upgrade silently. Report the gap first and wait for direction.
- Acceptance: a short report of Expo SDK, React Native version, the planned EAS build image and its Xcode version, and whether an Expo SDK upgrade is needed.

Task 2.2. App icon alpha fix.
- Blocker from the status: the iOS icon has an alpha channel. Apple rejects icons with transparency.
- Produce a 1024 by 1024 RGB PNG with no alpha channel. Flatten any transparency onto a solid background. Wire it as the iOS app icon in the app config.
- Acceptance: the iOS icon is 1024 by 1024, RGB, no alpha, and references correctly in the config.

Task 2.3. Privacy manifest.
- Apple has required a privacy manifest since May 1, 2024. Expo adds manifests for its own modules, but third party libraries and required reason API usage can still trigger ITMS-91053 or ITMS-91055 warnings on upload.
- Ensure a PrivacyInfo.xcprivacy exists, declares the app's collected data types, and declares approved reason codes for any required reason APIs used by the app and its static dependencies. If a first upload returns an ITMS privacy warning, add the listed reasons and rebuild.
- Acceptance: a privacy manifest is present and complete enough to clear ITMS privacy warnings, matching the App Privacy answers in Phase 5.

Task 2.4. Liquid Glass appearance check.
- Building against the iOS 26 SDK applies the new Liquid Glass look to native UI components by default unless you opt out. This can change how native controls render.
- Build to a simulator or TestFlight and review key screens. If the new look breaks the design, opt out per Apple's guidance and retest.
- Acceptance: the app's native controls look correct on iOS 26, with a note on whether you opted out.

Task 2.5. iOS push and APNs.
- The Android FCM push is validated. iOS push is separate and still pending per the status.
- Add the Push Notifications capability and the aps-environment entitlement. Create or use an APNs authentication key (.p8) and upload it to Firebase project twofer-b64b2 so FCM can deliver to iOS. Confirm the iOS bundle ID matches the one registered with Apple and in Firebase.
- Do not print the .p8 key or its key ID secret material.
- Acceptance: push capability and entitlement are present, the APNs key is wired to Firebase, ready to validate on a real device in Phase 7.

Task 2.6. Sign in with Apple. CONDITIONAL on D5.
- If the app offers social or third party login, add the Sign in with Apple capability and a working Sign in with Apple flow. If email and password only, skip.
- Acceptance: if applicable, Sign in with Apple is present and functional.

Task 2.7. Associated Domains for Share Deal links. CONDITIONAL on D3.
- If Share Deal ships in v1 and the share link should open the app on iOS, add the Associated Domains entitlement for the twoferapp.com domain and publish an apple-app-site-association file on the website, see Task 3.3.
- Acceptance: if applicable, the entitlement is present and the AASA file is staged for the website.

Task 2.8. Export compliance flag.
- Set ITSAppUsesNonExemptEncryption in the app config. For standard HTTPS only usage this is usually false, which avoids an export compliance prompt on every upload. Confirm the app uses only exempt encryption before setting false.
- Acceptance: the flag is set with a one line justification.

Task 2.9. Audio transcription disclosure alignment.
- The status requires that copy and disclosures say audio is sent to an AI transcription service, not processed purely on device.
- Make the in app text, the privacy policy, and the App Privacy answers in Phase 5 agree. Confirm Info.plist has a clear NSMicrophoneUsageDescription if the app records audio.
- Acceptance: all three sources state audio leaves the device for transcription, and the microphone usage string is clear.

Task 2.10. Usage strings and permissions.
- Confirm Info.plist has clear, specific purpose strings for every sensitive permission the app uses, at least location (NSLocationWhenInUseUsageDescription) and microphone if used. Vague or missing strings are a frequent rejection.
- Confirm whether location is when in use only or always. Avoid requesting always location unless a feature truly needs it.
- Acceptance: a table of iOS permissions, the purpose string text, and the feature that uses each.

Task 2.11. Set version and build number. **STOP GATE.**
- Apply only the values approved in D4 across the app config and native fields.
- Acceptance: marketing version and build number match the approved values.

Task 2.12. Regression check.
- Run typecheck, lint, and tests. Note that a full iOS build cannot run locally on Windows, so the first real iOS compile happens on EAS cloud in Phase 6. Do not attempt a local iOS build.
- Acceptance: typecheck, lint, tests pass. Working tree clean except known artifacts.

---

## Phase 3. Website and public pages (website repo, parallel with Phase 2)

Repo: `v0-twofer-landing-page`.

Task 3.1. Account deletion.
- Apple guideline 5.1.1 requires apps that support account creation to let users start account deletion from within the app. The status confirms in app delete exists for both consumer (Settings, Delete my account) and business (Account tab, Delete my account). Verify it actually deletes the account, not just hides it.
- Keep or finish the public delete account page too. It is good practice and supports the privacy disclosures. Suggested URL https://www.twoferapp.com/delete-account, reachable with no login, describing what is deleted, what is retained and for how long, and how to request deletion.
- **STOP GATE on publishing** the public page since it is public content.
- Acceptance: in app deletion verified working in both account types, and the public page wording reviewed.

Task 3.2. Privacy policy.
- Confirm a live public privacy policy that covers location, push, audio sent to a third party AI transcription service, account data, and the third parties involved, at least Supabase, the transcription provider, and Firebase. It must match the billing posture from D2.
- Acceptance: a live privacy policy URL covering those items.

Task 3.3. Apple app site association file. CONDITIONAL on D3 and Task 2.7.
- If Share Deal links should open the app on iOS, publish the apple-app-site-association file at the correct path on twoferapp.com with the app's team ID and bundle ID. **STOP GATE on publishing.**
- Acceptance: if applicable, the AASA file is correct and, after the gate, served correctly.

Task 3.4. Share preview route recheck.
- Reconfirm `/s/[shareCode]` returns 200 and leaks no tokens or private data.
- Acceptance: route returns 200, leak scan clean.

---

## Phase 4. App Store assets (parallel with Phases 2 and 3)

Task 4.1. Graphics.
- App icon: handled in Task 2.2, 1024 by 1024 RGB no alpha.
- iPhone screenshots: lead with the 6.9 inch class at 1320 by 2868 pixels. Apple scales that down to smaller iPhones, so one iPhone set is the minimum, 4 to 8 is recommended. Capture from the real app on a simulator or device. Match portrait orientation. Exact pixel dimensions matter, off by one rejects.
- iPad screenshots: 13 inch at 2064 by 2752, only if D6 keeps iPad support.
- Do not fabricate screenshots, they must show the real app.
- Acceptance: icon plus the iPhone screenshot set at correct dimensions, plus iPad set if applicable.

Task 4.2. Store copy.
- App name up to 30 characters, subtitle up to 30, keywords up to 100 characters total, promotional text up to 170, description up to 4000.
- Copy must accurately describe the audio transcription behavior and match the billing posture from D2. Remove "No subscription" if billing is live.
- Apply Dan's writing style: plain and direct, contractions, no em dashes, no semicolons, no stock phrases.
- Acceptance: name, subtitle, keywords, promo text, and description drafted and consistent with D2 and the audio disclosure.

Task 4.3. Listing metadata.
- Category, support URL, marketing URL, privacy policy URL, copyright line, contact email and phone.
- Acceptance: all fields drafted and ready to enter.

---

## Phase 5. App Store Connect content forms (Dan completes in console, agent drafts answers)

Task 5.1. App Privacy answers.
- Map every collected data type to whether it is linked to the user and whether it is used for tracking. Cover location, identifiers, app activity, and audio sent for transcription.
- Match the privacy policy and D2. If pilot only and free, no purchase data is collected.
- Acceptance: a drafted answer sheet for the App Privacy section.

Task 5.2. Age rating questionnaire.
- Apple updated the age rating questions, with responses expected since January 31, 2026. A new app answers the current questionnaire. Answer truthfully about user generated content, sharing features such as Share Deal, and location.
- Acceptance: drafted age rating answers.

Task 5.3. App access for the reviewer. **Common rejection cause if skipped.**
- Provide working demo credentials for a consumer account and a business account, seeded with demo data, so the reviewer can reach the Business Dashboard, the AI Draft review screen, and the main consumer flows.
- Use dedicated reviewer demo accounts, not a personal account. Paste finalized review notes.
- Acceptance: seeded consumer and business demo accounts with stable credentials, plus review notes.

Task 5.4. Export compliance answer.
- Answer the encryption question to match Task 2.8.
- Acceptance: drafted answer.

Task 5.5. Other declarations.
- Content rights, third party content, and whether the app shows ads, likely none.
- Acceptance: drafted answers.

---

## Phase 6. First cloud build (.ipa). STOP GATE for the whole phase.

Nothing here runs until Dan approves. First time touching build config, signing, and version.

Task 6.1. Apply the staged version and any EAS iOS profile changes from Phase 2.
- Commit on the current branch. Do not push.

Task 6.2. Build the iOS app on EAS cloud.
- Run `eas build -p ios` against the profile that targets the App Store and uses the Xcode 26 image. This is a cloud build because Windows cannot build iOS. It consumes a build credit.
- Let EAS manage the distribution certificate and provisioning profile, or use credentials you control. Register the bundle ID with Apple if not already.
- Acceptance: a signed .ipa is produced against the iOS 26 SDK.

Task 6.3. Back up signing credentials.
- Use `eas credentials` to confirm and securely back up the iOS distribution certificate and provisioning profile.
- Do not print certificate or key material.
- Acceptance: credentials backed up safely, no secrets printed.

---

## Phase 7. TestFlight (strongly recommended, not a hard gate)

Task 7.1. Upload to App Store Connect. **STOP GATE.**
- Use `eas submit -p ios` or Apple Transporter. eas submit needs an App Store Connect API key (.p8). Store it securely, do not print it.
- Acceptance: the build appears in App Store Connect and processes for TestFlight.

Task 7.2. Internal TestFlight test on a real device.
- Add internal testers, up to 100, which need no beta review. Install on a real iPhone and, if D6 keeps iPad, an iPad.
- Validate the full flow set from the validated list, now on iOS: feed, deal detail and back navigation, account deletion in both account types, location denial fallback, AI Draft to review, Business Dashboard, and Share Deal if it ships.
- Validate iOS push delivery through APNs, the pending item from the status. Use a single controlled recipient.
- Do not print push tokens.
- Acceptance: the build runs from TestFlight, iOS push works, all listed flows pass, no crashes.

Task 7.3. Optional external TestFlight.
- If you want wider testing, external TestFlight needs a one time Beta App Review, usually about a day. Optional for v1.
- Acceptance: if used, external testers can install.

---

## Phase 8. App Store submission. STOP GATE.

Task 8.1. Complete the App Store version in App Store Connect: attach the build, screenshots, copy, App Privacy, age rating, app access, and export compliance.

Task 8.2. Submit for review. **STOP GATE before submitting.**
- Typical review is about a day or two. Pre empt the common rejections: Sign in with Apple if you have social login, a weak or broken demo account, App Privacy answers that do not match behavior, vague permission strings, and minimum functionality concerns.
- Acceptance: submitted, status visible.

Task 8.3. Choose release type.
- Recommend manual release after approval so you control the go live moment.
- Acceptance: release option set.

---

## Phase 9. Post approval

Task 9.1. Release manually once approved. Monitor crashes and metrics in App Store Connect. Respond to reviewer messages quickly if anything is flagged.

Task 9.2. Log deferred items into a short backlog: the Google Play release, Share Deal if held in D3, billing if deferred in D2, and iPad if dropped in D6.

---

## Google Play, later phase

Do this after iOS is live. The earlier Google Play plan still applies, file twofer-google-play-submission-plan-20260607.md. The key driver there is the developer account type. A personal account created after November 13, 2023 must run closed testing with at least 12 testers for 14 consecutive days before production access. An organization account is exempt. iOS has no equivalent wall, which is why iOS first reaches the public store sooner.

Reuse across both stores: the privacy policy, the account deletion page, the audio transcription disclosure, the store copy with the correct billing posture, and the reviewer demo accounts. The Android specific work that does not carry over is the AAB build format, the Data safety form, and the closed testing wall if the account is personal.

---

## Parallelization map

Run at the same time once Phase 0 decisions are in:
- Phase 2 iOS compliance fixes.
- Phase 3 website pages.
- Phase 4 App Store assets.
- Phase 5 App Store Connect answer drafts.

Strictly sequential:
- Phase 6 cloud build, then Phase 7 TestFlight, then Phase 8 submission, then Phase 9 release.

The one item that can blow up the schedule is Task 2.1. If the app needs an Expo SDK upgrade to build against the iOS 26 SDK, resolve that before parallelizing the rest, because it can change behavior across the app.

---

## Rough timeline

If no Expo SDK upgrade is needed and enrollment is already done: roughly a few days to about a week, most of it your own asset and form work plus a one to two day review.

If an Expo SDK upgrade is needed: add the upgrade and regression time, which can be the largest single piece, before the build phases.

There is no multi week tester wall on iOS, unlike the Google Play personal account path.

---

## Open iOS blockers carried from the status, mapped to phases

- iOS icon alpha channel. Phase 2.2.
- iOS TestFlight and iOS push validation pending. Phases 7.1, 7.2.
- Privacy and App Privacy answers. Phase 5.1.
- Audio transcription in copy. Phases 2.9, 4.2, 5.1.
- Billing posture. Decision D2.
- Screenshots. Phase 4.1.
- Reviewer demo notes finalized. Phase 5.3.
- iPad screenshots if tablet support stays on. Decision D6, Phase 4.1.
- Production submission not started. Phase 8.

New iOS specific items not in the original Android blocker list: Xcode 26 and iOS 26 SDK requirement (Phase 2.1), privacy manifest (Phase 2.3), Sign in with Apple if social login exists (Phase 2.6, Decision D5), APNs key wiring (Phase 2.5), and the Liquid Glass appearance default (Phase 2.4).
