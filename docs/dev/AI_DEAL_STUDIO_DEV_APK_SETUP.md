# AI Deal Studio Dev APK Setup

This setup is only for a local Android development APK that installs beside the Google Play closed-testing app.

## Safety Rules

- Production package stays `com.unvmex2.twoforone`.
- Dev package is `com.unvmex2.twoforone.dev`.
- Dev app name is `Twofer Dev`.
- The active project is production Supabase (`kvodhiqhdqnptqovovia`). The dev APK may use it only while AI Studio publishing is disabled.
- Do not put Supabase service role keys, OpenAI keys, signing keys, passwords, or keystores in GitHub.
- AI Studio publishing is disabled with `EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING=true`.

## Local Env File

1. Copy `.env.development.local.example` to `.env.development.local`.
2. Replace placeholders with the active Supabase project public values:

```env
EXPO_PUBLIC_SUPABASE_URL=https://kvodhiqhdqnptqovovia.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
```

3. Keep these dev flags:

```env
TWOFER_APP_VARIANT=ai-studio-dev
EXPO_PUBLIC_APP_VARIANT=ai-studio-dev
EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV=true
EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING=true
```

`.env.development.local` is ignored by Git. Do not rename it to a tracked file.

## Print And Verify Config

From Windows 11 PowerShell:

```powershell
$env:TWOFER_APP_VARIANT="ai-studio-dev"
$env:EXPO_PUBLIC_APP_VARIANT="ai-studio-dev"
$env:EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV="true"
$env:EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING="true"
$env:EXPO_PUBLIC_SUPABASE_URL="https://kvodhiqhdqnptqovovia.supabase.co"
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY="<SUPABASE_ANON_KEY>"
npx expo config --type public
```

Confirm:

- `name` is `Twofer Dev`
- `android.package` is `com.unvmex2.twoforone.dev`
- `EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING` is `true`

Production config check:

```powershell
Remove-Item Env:\TWOFER_APP_VARIANT -ErrorAction SilentlyContinue
Remove-Item Env:\EXPO_PUBLIC_APP_VARIANT -ErrorAction SilentlyContinue
Remove-Item Env:\EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV -ErrorAction SilentlyContinue
Remove-Item Env:\EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING -ErrorAction SilentlyContinue
npx expo config --type public
```

Confirm:

- `name` is `Twofer`
- `android.package` is `com.unvmex2.twoforone`
- `android.versionCode` is unchanged

## Build Local APK On Windows 11

Do not use EAS local builds on Windows. Load `.env.development.local`, then use the dedicated dev APK profile or the local Android project after setting the dev variant environment.

PowerShell helper for the current terminal only:

```powershell
$lines = Get-Content .\.env.development.local
foreach ($line in $lines) {
  if ($line -match '^\s*#' -or $line.Trim() -eq '') { continue }
  $idx = $line.IndexOf('=')
  if ($idx -gt 0) {
    $name = $line.Substring(0,$idx)
    $value = $line.Substring($idx + 1)
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
```

Dedicated EAS profile command, APK output only:

```powershell
eas build --platform android --profile dev-apk-ai-studio --local
```

If local EAS build is unavailable on the machine, use the local Android project and Gradle:

```powershell
npx expo prebuild --platform android
Set-Location android
.\gradlew.bat assembleDebug
Set-Location ..
```

The debug APK is written under `android\app\build\outputs\apk\debug\`. The `dev-apk-ai-studio` EAS profile exists only as a dedicated APK profile for this variant and must not be used to change production, preview, closed-testing AAB, versionCode, or signing settings.

If prebuild updates tracked Android files during local testing, review them before committing. For this dev foundation, the durable source of truth is the Expo config variant in `app.config.js`.

## Confirm APK Package

After the APK exists, use Android build tools:

```powershell
aapt dump badging path\to\app.apk | Select-String "package:"
```

Confirm the package name is:

```text
com.unvmex2.twoforone.dev
```

After installing on a connected device, verify the installed package directly:

```powershell
adb shell pm list packages | Select-String "com.unvmex2.twoforone"
```

Expected result includes both packages when the Play closed-testing app is already installed:

```text
package:com.unvmex2.twoforone
package:com.unvmex2.twoforone.dev
```

## Install Beside Play Closed Testing

With the Samsung S10 connected by USB and USB debugging enabled:

```powershell
adb devices
adb install -r path\to\app.apk
```

Because the package id differs from production, Android installs `Twofer Dev` beside the Play closed-testing app instead of replacing it.

## Confirm Supabase Host And Disabled Publishing

Open `Twofer Dev`, sign in with the dev account, then open Diagnostics. Confirm:

- the app name is `Twofer Dev`
- the package is `com.unvmex2.twoforone.dev`
- `EXPO_PUBLIC_SUPABASE_URL` displays `kvodhiqhdqnptqovovia.supabase.co`
- `EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING` is `true`
- the AI Deal Studio screen shows `Publishing disabled in dev build`

The AI Deal Studio screen always calls `ai-studio-generate-draft` in `dry_run` and `copy_only` mode. It does not publish and does not create live feed deals.

## Rollback

Delete the local dev APK from the device:

```powershell
adb uninstall com.unvmex2.twoforone.dev
```

Remove local env values if needed:

```powershell
Remove-Item Env:\TWOFER_APP_VARIANT -ErrorAction SilentlyContinue
Remove-Item Env:\EXPO_PUBLIC_APP_VARIANT -ErrorAction SilentlyContinue
Remove-Item Env:\EXPO_PUBLIC_ENABLE_AI_DEAL_STUDIO_DEV -ErrorAction SilentlyContinue
Remove-Item Env:\EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING -ErrorAction SilentlyContinue
```

No production Supabase deployment, production package id, versionCode, or closed-testing AAB flow is changed by this dev foundation.
