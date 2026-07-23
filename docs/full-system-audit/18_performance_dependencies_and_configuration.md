# Performance, dependencies, and configuration

## F-007 — Native dependency health (P2)

Expo Doctor failed 2 of 18 checks: root React Native 0.81.5 coexists with a nested 0.86.0 in the installed dependency graph, and `react-native-launch-arguments` is untested on the New Architecture. `npm ls react-native --all` confirmed the nested duplicate. Resolve through SDK 54-supported versions; do not force an unsupported upgrade. Re-run deterministic install, Doctor, Metro, local debug QA, then approved release builds.

## F-014 — Dependency advisories (P3)

`npm audit --omit=dev` reported 18 moderate transitive advisories involving `postcss` and `uuid` ranges. Its suggested automatic remedy crosses to a breaking Expo version. Assess reachability and update through supported dependency paths; no force-fix was run.

## F-011/F-012 — Configuration truth

Local Supabase Auth has confirmation off, six-character minimum/no requirements, and secure password change off (`supabase/config.toml:171-174`, `:205`, `:207`). Hosted settings are unknown. Docs also misstate Android versionCode, billing bypass, and migration inventory. Generate state from source and distinguish intended, source, deployed, and last-verified values.

## Performance gaps

No cold-start, bundle size, JS/native memory, map marker scale, list rendering, image/cache, API latency, slow network, battery, database plan/index, website Core Web Vitals, or load test was run. Define budgets and exercise representative data volumes before launch.

