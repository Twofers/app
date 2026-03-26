# TWOFER — EAS Build & Production Setup Guide

Expo SDK 54 · React Native 0.81.5 · EAS CLI ≥ 16.0.0

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20 LTS | https://nodejs.org |
| EAS CLI | ≥ 16.0.0 | `npm install -g eas-cli` |
| Expo account | — | https://expo.dev |
| Xcode | 16+ | Mac App Store (iOS only) |
| Android Studio | Ladybug+ | (Android only) |

---

## 1. One-time EAS Login

```bash
eas login
# Enter your Expo account credentials
eas whoami   # verify
```

The project is already linked: EAS project ID `cf448cfe-fabd-4c32-8afd-88104bb59cbe` (owner: `unvmex2`).

---

## 2. Environment Variables

### App-side (client) — `.env`

```env
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

These are embedded at build time. Production builds pick them up from EAS environment variables (set in the Expo dashboard or via `eas env:create`).

### Set production env vars in EAS

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL   --value "https://..." --environment production
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "eyJ..."   --environment production
```

### Edge function secrets — Supabase dashboard

Set these under **Project → Settings → Edge Functions → Secrets**:

| Secret | Description |
|--------|-------------|
| `OPENAI_API_KEY` | OpenAI API key (required for all AI features) |
| `OPENAI_MODEL` | Optional override — defaults to `gpt-4o-mini` |

### Debug flags (dev/preview only — NOT production)

The `development` and `preview` profiles in `eas.json` set these automatically:
- `EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER=true`
- `EXPO_PUBLIC_SHOW_DEBUG_PANEL=true`
- `EXPO_PUBLIC_DEBUG_BOOT_LOG=true`
- `EXPO_PUBLIC_PREVIEW_MATCHES_DEV=true`

These are absent from the `production` profile — production builds are clean.

---

## 3. Build Profiles

```json
// eas.json
{
  "build": {
    "development": { ... },   // dev client, internal distribution
    "preview":     { ... },   // internal distribution, debug flags on
    "production":  { ... }    // store-ready, no debug flags
  }
}
```

---

## 4. Building for Production

### Android (AAB — Google Play)

```bash
cd path/to/twoforone
eas build --platform android --profile production
```

- Outputs an `.aab` (Android App Bundle) uploaded to EAS
- First build: EAS generates and stores a keystore automatically
- **Save the keystore** — you need it for every future update to the same Play Store listing
- Download it: `eas credentials` → Android → Download keystore

### iOS (IPA — App Store)

```bash
eas build --platform ios --profile production
```

- Requires an Apple Developer account ($99/yr)
- First build: EAS will ask to create or reuse provisioning profiles and certificates
- Outputs a signed `.ipa` uploaded to EAS

### Both platforms at once

```bash
eas build --platform all --profile production
```

---

## 5. Submitting to Stores

### App Store (iOS)

```bash
eas submit --platform ios --latest
```

- Requires App Store Connect API key — set up once with `eas credentials`
- Uploads the latest iOS build from EAS to TestFlight / App Store Connect

Manual alternative: download the `.ipa` from the EAS dashboard and upload via Transporter (Mac app).

### Google Play (Android)

```bash
eas submit --platform android --latest
```

- Requires a Google Play service account JSON key
- Guide: https://expo.fyi/creating-google-service-account

---

## 6. Over-the-Air Updates (EAS Update)

For JS-only changes (no native code) you can push an update without a new store submission:

```bash
eas update --branch production --message "Fix: ..."
```

Users get the update automatically in the background on next app launch.

---

## 7. Supabase Edge Functions — Deploy to Production

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>

# Deploy all functions
npx supabase functions deploy

# Or deploy one at a time
npx supabase functions deploy ai-compose-offer
npx supabase functions deploy ai-generate-ad-variants
npx supabase functions deploy ai-create-deal
npx supabase functions deploy ai-generate-deal-copy
npx supabase functions deploy claim-deal
npx supabase functions deploy redeem-token
npx supabase functions deploy begin-visual-redeem
npx supabase functions deploy complete-visual-redeem
npx supabase functions deploy cancel-visual-redeem
npx supabase functions deploy finalize-stale-redeems
npx supabase functions deploy delete-user-account
npx supabase functions deploy ingest-analytics-event
```

After deploying, set edge function secrets (see Section 2 above).

---

## 8. Pre-submission Checklist

### App Store Connect setup
- [ ] Bundle ID registered: `com.twofer.app`
- [ ] App record created in App Store Connect
- [ ] App icons uploaded (1024×1024 PNG, no transparency)
- [ ] Screenshots uploaded (see `store-assets/app-store-copy.md` for sizes)
- [ ] Description, subtitle, keywords filled in
- [ ] Privacy policy URL entered (e.g. `https://twofer.app/privacy`)
- [ ] Age rating completed (Everyone / 4+)

### Google Play Console setup
- [ ] Package name registered: `com.unvmex2.twoforone`
- [ ] App record created in Google Play Console
- [ ] Adaptive icon assets uploaded (already in `assets/images/`)
- [ ] Screenshots uploaded
- [ ] Store listing text filled in
- [ ] Privacy policy URL entered
- [ ] Content rating questionnaire completed

### Production smoke test (on a physical device)
- [ ] Auth: sign up + log in flow
- [ ] Consumer: browse deals, claim deal, show QR
- [ ] Consumer: wallet shows claimed deal
- [ ] Consumer: map shows business pins
- [ ] Business: create deal (Quick Create)
- [ ] Business: AI Compose — text input → generate
- [ ] Business: AI Compose — photo input → generate
- [ ] Business: Redeem — scan customer QR
- [ ] Business: Dashboard shows analytics
- [ ] Push notifications received (requires physical device)

---

## 9. App Version Management

`eas.json` sets `"appVersionSource": "remote"` — version numbers are managed in the EAS dashboard, not in `app.json`. Bump the version before each release:

```bash
eas build:version:set --platform ios --version-code 2
eas build:version:set --platform android --version-code 2
```

Current version: `1.0.0` (build 1)

---

## 10. Useful Commands

```bash
# Check build status
eas build:list

# View logs for a specific build
eas build:view <build-id>

# Inspect current credentials
eas credentials

# Run locally with dev client
npx expo start --dev-client

# Run on iOS simulator (no EAS needed)
npx expo run:ios

# Run on Android emulator (no EAS needed)
npx expo run:android
```
