# iOS visual/platform parity audit - 2026-06-09

Scope: pre-TestFlight code audit for iOS-only native UI differences that Android QA would not catch. No iOS build, signing, version, build number, capability, entitlement, EAS profile, or release config changes were made.

## Code search coverage

- Expo Router stack headers and titles: `Stack.Screen`, `screenOptions`, `headerShown`, `headerBackTitle`, `headerBackButtonDisplayMode`, route navigation.
- Native controls: `DateTimePicker`, `Switch`, `Share.share`, camera, location, notifications, image picker, microphone permissions.
- iOS/platform branches: `Platform.OS`, `Platform.select`, safe area helpers, keyboard-aware wrappers.
- Modals and sheets: app `Modal` usage, QR/redeem/report sheets, iOS schedule and birthdate picker sheets.
- Keyboard behavior: route-level `TextInput` usage and `KeyboardScreen` coverage.

## Fixes made

- Root and create native stacks now set iOS back buttons to icon-only, disable the iOS back-button menu, use explicit empty back titles, and apply branded header tint/title styling. This reduces the chance of previous route labels or Expo Router route names appearing in iOS headers.
- Native `Switch` controls now use a shared `BrandedSwitch` wrapper instead of default iOS green styling.
- iOS birthdate and schedule picker sheets now explicitly use `overFullScreen` presentation and modal accessibility scope.
- The iOS schedule `DateTimePicker` now explicitly uses spinner display, light theme, app text color, and stable height so iOS does not fall back to a different native picker look.

## Findings to verify in TestFlight

- Stack headers: navigate through auth recovery, consumer profile edit, business setup, business detail, and all create-flow screens. Confirm back buttons show only the chevron and never route names like `ai`, `menu-scan`, `[id]`, or `(tabs)`.
- Date and time pickers: confirm consumer birthdate and AI deal schedule pickers show as branded bottom sheets with readable spinner text, correct Cancel/Done controls, and no compact inline iOS picker.
- Modals and bottom sheets: confirm QR, redeem pass, report sheet, deal preview, and branded confirms clear the notch/home indicator and dismiss correctly.
- Safe area spacing: inspect first-paint spacing on visible native-stack screens. Watch for double top gaps below headers, especially consumer profile, business setup, forgot/reset password, business detail, and create-flow screens.
- Keyboard behavior: confirm numeric keyboards have the Done accessory on ZIP, code, price, claim, and cutoff inputs. Confirm long forms scroll above the iOS keyboard.
- Permission prompts: confirm iOS copy for location, notifications, camera, photo library, and microphone matches the in-app action that triggered it. Microphone copy must make clear that voice input is recorded and transcribed into deal copy.
- Share sheet: confirm Share Deal opens the native iOS share sheet, not an Android-specific action surface.

## Verification run

- `.\node_modules\.bin\tsc.cmd --noEmit`: passed.
- `.\node_modules\.bin\expo.cmd lint`: passed.
- `.\node_modules\.bin\vitest.cmd run`: passed, 30 files and 209 tests.

Note: `npm run ...` could not be used because local npm resolves to a missing Roaming npm CLI path on this Windows machine. The underlying local project binaries were run directly.
