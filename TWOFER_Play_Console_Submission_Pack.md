# TWOFER Play Console Submission Pack

Date: 2026-06-07
Account path: personal Google Play account, Twofer already attached. Closed testing applies.
Scope: everything that can be drafted now. The only open items are the phone number for the listing, which is optional, and the 12 tester names, which you said come last.

A few things must be checked against the iOS App Privacy answers and the actual app behavior before you submit, so the Play answers stay consistent with iOS. Those are flagged inline with CONFIRM.

---

## 1. Store listing

Title limit is 30 characters, short description 80, full description 4000. Confirm these limits in the Console at submission time, since Play adjusts them occasionally.

### Title, pick one

- Twofer: BOGO Coffee Deals (25)
- Twofer: Local BOGO Deals (24)
- Twofer - BOGO Cafe Deals (24)

Primary recommendation is the first. It names the product and the wedge.

### Short description, 80 max

Free buy-one-get-one deals at local coffee shops and cafes around DFW.

That runs 70 characters. Alternate, if you want the brand promise instead of the geography:

Find buy-one-get-one deals at independent coffee shops and cafes near you.

### Full description, 4000 max

Twofer helps you find buy-one-get-one deals at independent coffee shops, cafes, and bakeries around the Dallas-Fort Worth area. Open the app, see the live deals nearby, claim the one you want, and redeem it in person. That is the whole idea. Good coffee, a deal worth using, and your money going to a local owner instead of a chain.

We built Twofer for the independent coffee scene in Irving, Coppell, Grapevine, and Carrollton. These are the shops run by people who know your order, and they are the ones the app is here to support. Every deal you see comes straight from the cafe offering it.

What you can do:

Browse the latest buy-one-get-one deals from cafes near you.
Claim a deal in a tap and redeem it at the counter.
Share a deal you like with a friend so they can grab it too.
Turn on notifications to hear about new deals as shops post them.

See a deal worth passing along? Send it to a friend from inside the app, and they can open it and claim it for themselves.

If you run an independent coffee shop, cafe, or bakery, Twofer gives you a simple way to reach people nearby and bring them through the door during slow hours. Post a buy-one-get-one deal, manage it from your dashboard, and see how it performs. The app also includes AI tools that help you draft deal copy, pull menu items from a photo, and polish your deal images, so posting a deal takes a minute, not an afternoon. The pilot is free while we get going in DFW.

Twofer is free to download and use. No ads. Sign in with an email and password, and you are ready.

### Graphics needed, you produce these

- App icon, 512 by 512 PNG.
- Feature graphic, 1024 by 500.
- At least 2 phone screenshots. Capture the deals list, an open deal, the claim or redeem screen, a map or strong consumer screen, and the business dashboard. The Android Studio emulator on your Windows machine is fine for screenshots.

### Listing contact and URLs

- Privacy policy URL: https://www.twoferapp.com/privacy
- Support email: support@twoferapp.com
- Support website, optional: https://www.twoferapp.com/support
- Phone, optional: Play does not require a phone for the listing, only an email. You can ship without it and add one later.

---

## 2. Data Safety form

Built from your live privacy policy dated June 7, 2026. The Data Safety form must match the iOS App Privacy sheet exactly, so reconcile every line below against iOS before you submit. CONFIRM each one.

### Top-level answers

- Does your app collect or share any of the required user data types: Yes, it collects.
- Is all of the user data collected by your app encrypted in transit: Yes. Supabase and your service providers operate over HTTPS. CONFIRM nothing leaves the device unencrypted.
- Do you provide a way for users to request that their data be deleted: Yes. Consumers delete from Settings, businesses from the Account tab, plus email and the delete-account page. This matches the privacy policy.
- Does your app share user data with third parties: No, in Play's sense. Your third parties are service providers that process on your behalf, which Play does not count as sharing. Aggregated and de-identified business reporting is not personal data, and public deal and share links show the business's own public listing, not consumer personal data. CONFIRM this matches how the iOS sheet was answered, since this is the line most likely to drift.

### Data types collected

Location
- Approximate location. Collected. Purpose: app functionality. Optional, since users can choose ZIP instead of GPS. Not shared.
- Precise location. Collected only if the user grants GPS access. Purpose: app functionality, nearby deals and maps. Optional. Not shared.

Personal info
- Email address. Collected. Required. Purpose: app functionality and account management. Not shared.
- Name. Collected, business owner or contact name. Purpose: app functionality and account management. Not shared.
- User IDs. Collected, authentication identifiers. Purpose: app functionality. Not shared.
- Address. Collected, business address used for maps and nearby sorting. Purpose: app functionality. Note this is business-provided listing info shown publicly with deals.
- Phone number. Collected, business phone. Purpose: app functionality. Note this is business listing info.
- Other personal info. Optional consumer birthdate and age range, and ZIP code. Collected. Purpose: app functionality. Optional. CONFIRM how iOS classified birthdate and age range.

Photos and videos
- Photos. Collected, deal photos, business logos, and menu photos. Purpose: app functionality. Business-posted images appear publicly in deals.

Audio
- Voice or sound recordings. Collected when the user uses AI Compose voice input. Purpose: app functionality. Audio is sent to the transcription provider and the transcript is returned. CONFIRM whether the raw audio is stored or processed ephemerally, and answer Play's "processed ephemerally" question to match.

App activity
- App interactions. Collected, deals viewed, claimed, redeemed, shared, saved, and businesses viewed, favorited, reported. Purpose: app functionality and analytics.
- Other user-generated content. Collected, deal titles, descriptions, prices, menu items, business descriptions, and reports. Purpose: app functionality.

App info and performance
- Diagnostics. Collected, sanitized error and diagnostic data: error source, fatal flag, error name, error hash, app version, app build, platform. Purpose: app functionality. Not linked to identity, not for tracking. Note your policy says you do not collect raw crash logs, so do not check the Crash logs box, only Diagnostics.

Device or other IDs
- Device or other IDs. Collected, Expo push tokens for notification delivery. Purpose: app functionality. Not for tracking or ads.

### Tracking and ads

- No cross-app tracking. Your policy states this directly.
- No ads.
- No data sold.

---

## 3. Content rating, IARC questionnaire

Answer to land at the same rating as iOS, which is 13+ driven by infrequent alcohol references.

- Violence: none.
- Sexuality or nudity: none.
- Profanity or crude humor: none.
- Controlled substances: references to alcohol are infrequent but possible, since some participating businesses may reference or serve alcohol and a deal could mention it. Answer the alcohol question yes, infrequent. This is the line that sets the rating, and it must match the iOS alcohol disclosure. CONFIRM against iOS.
- Gambling: none, no simulated or real gambling.
- User interaction and sharing: users can share deals with others, and the app uses location for nearby features. There is no open user-to-user chat or social feed. Answer the share-content and share-location questions accordingly. CONFIRM how iOS answered the sharing and location interaction questions.
- User-generated content: businesses post deal content. There is no consumer-to-consumer posting. Answer consistently with the moderation you actually do.

---

## 4. Target audience and content settings

- Target age group: 13 and up. Not directed to children. This matches your privacy policy, which states Twofer is not directed to children under 13.
- Ads declaration: the app contains no ads. Declare no ads.
- Designed for Families: do not opt in. The app is not a children's app.

---

## 5. App access, for Play review

Provide reviewers a working login so they can see both sides of the app.

- Username: demo@demo.com
- Password: [demo password, you provide, do not commit it anywhere in the repo]
- Notes for the reviewer: This account reaches both the consumer side and the business side. Deals are already posted, so the deals list, an open deal, and the claim or redeem flow are all reachable. The business dashboard is reachable from the same login. Sign in uses email and password only. There is no email magic link and no one-time code.

---

## 6. Android App Links files, for Codex to place in the repos

These pair with the iOS AASA so Share Deal opens the app on Android. The fingerprint is the one gap, and it only exists after the first AAB upload sets up Play App Signing.

### assetlinks.json

Path in the website repo: public/.well-known/assetlinks.json
Publishing this to the live site is a gate. Codex writes it and commits locally, you approve the push and deploy.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.unvmex2.twoforone",
      "sha256_cert_fingerprints": [
        "REPLACE_WITH_PLAY_APP_SIGNING_SHA256"
      ]
    }
  }
]
```

CONFIRM the package name against android.package in the app config. Replace the fingerprint with the app signing key SHA-256 you read from the Play Console after Play App Signing is set up, not the upload key. After deploy, verify the file serves a clean 200 as application/json at https://www.twoferapp.com/.well-known/assetlinks.json.

### Android intent filters, for the app config

Add to the android section of app.json or app.config. Scope to /s to match the iOS AASA path scope for Share Deal.

```json
"intentFilters": [
  {
    "action": "VIEW",
    "autoVerify": true,
    "data": [
      {
        "scheme": "https",
        "host": "www.twoferapp.com",
        "pathPrefix": "/s"
      }
    ],
    "category": ["BROWSABLE", "DEFAULT"]
  }
]
```

CONFIRM the iOS AASA uses the same /s path scope. If the iOS paths are narrower or wider, match them here so the two platforms behave the same. This change only takes effect at the next build, which is a gate.

---

## 7. Permissions audit, expected set

The app should declare only what it uses. Based on the privacy policy, expect:

- INTERNET, automatic.
- ACCESS_NETWORK_STATE, typical for Expo.
- POST_NOTIFICATIONS, Android 13 and up, requested by expo-notifications.
- Location permissions, since the app uses GPS for nearby deals when the user allows it. Expect ACCESS_COARSE_LOCATION and ACCESS_FINE_LOCATION. Confirm these are present because location is used, and that the app degrades to ZIP when the user declines.
- Camera and storage or photo access, since users upload deal, logo, and menu photos. Confirm these match the image features.
- Microphone, since AI Compose takes voice input. Confirm this is present and tied only to the voice feature.

Anything outside this set should be removed before submitting, since Play asks about sensitive permissions. Audit the generated manifest, do not add a full build just to read it, work from the config and the installed packages.

---

## 8. Tester opt-in sheet, template for your 12

Send this once you have the closed testing track live and the opt-in link. The names are the only thing still missing.

Subject: Help me test Twofer on Android, about 2 minutes a day for 2 weeks

Body:
Thanks for helping me get Twofer onto Google Play. Google requires real testers before I can publish, so I need 12 people to install the app and open it a few times over the next two weeks. Here is all it takes.

1. Tap this opt-in link from your Android phone: [CLOSED_TESTING_OPT_IN_URL]
2. Tap to become a tester, then install Twofer from the Play Store link on that page.
3. Open the app and look around. Browse the deals, open one, try the claim or redeem screen. A minute or two is plenty.
4. Please open it on a few different days across the two weeks, not just once. Google checks that testers actually used the app, so a quick daily open really helps.

If anything looks broken or confusing, tell me, since I have to summarize the feedback when I apply to publish. Thanks for the help.

Use real people on real Android phones. Emulators usually do not count toward the requirement, and 12 people who install once and never open it can get the application rejected for insufficient testing.

---

## Open items, what is left

- Phone for the listing, optional, ship without it if you like.
- The 12 tester names and emails, and the opt-in URL once the closed track exists.
- The demo account password, which you drop into the App access section at submission time and never commit.
- Confirm the demo password and the AASA path scope are the only things I had to leave as placeholders that you alone can fill.
