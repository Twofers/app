# TWOFER Android permissions audit

Date: 2026-06-08

Scope: repo-only audit for Google Play prep. No build was run, no Play Console action was taken, and no credentials or generated build artifacts were inspected. Sources checked were `app.json`, `android/app/src/main/AndroidManifest.xml`, debug manifests, and installed package `AndroidManifest.xml` files under `node_modules`.

## Explicit app config permissions

`app.json` explicitly requests:

- `android.permission.CAMERA`
- `android.permission.RECORD_AUDIO`
- `android.permission.ACCESS_COARSE_LOCATION`
- `android.permission.ACCESS_FINE_LOCATION`

The package name remains `com.unvmex2.twoforone`.

## Expected permission coverage

These permissions match app features or installed Expo modules:

- Internet and network state: `INTERNET` is present in the native app manifest and from image/file modules. `ACCESS_NETWORK_STATE` comes from `expo-image` so image loading can respond to connectivity changes.
- Notifications: `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` come from `expo-notifications`. The boot receiver supports notification behavior after device reboot.
- Location: `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` are present for nearby deals, radius sorting, map behavior, and saved area preferences. No background location permission was found.
- Camera: `CAMERA` is present for QR redemption, deal photos, and menu scan capture.
- Photo access: `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are present through image/file modules and the native manifest for image picking and uploads on older Android versions.
- Microphone: `RECORD_AUDIO` is present for AI Compose voice input and transcription.
- Haptics/notification vibration: `VIBRATE` is present from `expo-haptics` and the native manifest.

No contacts, SMS, phone, calendar, Bluetooth, advertising ID, background location, exact alarm, install packages, or query-all-packages permissions were found in the app config or relevant installed module manifests.

## Items to review before Play upload

- `SYSTEM_ALERT_WINDOW` appears in `android/app/src/main/AndroidManifest.xml`, plus debug manifests. This is unexpected for a production Play build and is usually a development overlay permission. Because `android/` is checked in, review and remove it from the main manifest before a real Play upload unless a production feature truly needs it.
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, and `MODIFY_AUDIO_SETTINGS` come from `expo-audio`. The app uses AI Compose voice recording, but media playback foreground-service permissions are broader than the current feature description. Review whether the module or manifest can be narrowed before upload, because Play may ask for foreground service declarations.
- `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are legacy photo/file permissions. They support older Android image picking and uploads, but broad storage permissions should be checked during the Play policy pass, especially since newer Android versions use the system photo picker.

## Notes

This is a static repo audit, not a final merged-manifest report. The final permission list should be rechecked from the generated AAB after the build gate approves an EAS production build.
