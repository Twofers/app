# Dependabot PR triage — 2026-07-31

Dependabot went live with the PR #25 merge and immediately opened eight PRs.
None should be merged as-is. Six would not build, two cannot pass their own CI
alone, and the configuration that produced them was wrong in two distinct ways —
both now fixed in `.github/dependabot.yml`.

## The eight PRs

| PR | Bump | Verdict |
| --- | --- | --- |
| [#34](https://github.com/Twofers/app/pull/34) | `expo-web-browser` 15.0.11 → 57.0.2 | **Close.** Expo SDK 57 package against an SDK 54 app |
| [#33](https://github.com/Twofers/app/pull/33) | `expo-status-bar` 3.0.9 → 57.0.1 | **Close.** Same; CI already fails |
| [#31](https://github.com/Twofers/app/pull/31) | `expo-splash-screen` 31.0.13 → 57.0.5 | **Close.** Same |
| [#32](https://github.com/Twofers/app/pull/32) | `react-native-url-polyfill` 3.0.0 → 4.0.0 | **Close.** Major, Expo-pinned |
| [#30](https://github.com/Twofers/app/pull/30) | group of 14, including `react-native` 0.81.5 → **0.86.2** and `react` 19.1.0 → 19.2.8 | **Close.** CI already fails. Contains genuinely wanted updates — see below |
| [#28](https://github.com/Twofers/app/pull/28) | `codeql-action/analyze` 3.37.3 → 4.37.3 | **Close.** Cannot pass alone |
| [#26](https://github.com/Twofers/app/pull/26) | `codeql-action/init` 3.37.3 → 4.37.3 | **Close.** Cannot pass alone |
| [#27](https://github.com/Twofers/app/pull/27) | `actions/checkout` 4.4.0 → 7.0.1 | **Mergeable.** Checks pass, SHA pin preserved |

## Cause 1 — Expo SDK packages were unconstrained

The app is on `expo ~54.0.35` / `react-native 0.81.5`. From SDK 55 onward Expo
renumbered its packages to match the SDK major, so `expo-web-browser@57.0.2`
means "the SDK 57 build of that package". Dependabot saw a newer version and
proposed it; nothing in the config said the version was not the app's to choose.
`react-native 0.81.5 → 0.86.2` reads as a minor bump to semver and is a platform
upgrade in practice.

The group was even named `expo-compatible-patches` while accepting `patch` and
`minor` for *every* npm package — the name asserted a constraint the config did
not implement.

Fixed by ignoring the SDK-managed set (`expo`, `expo-*`, `@expo/*`,
`react-native`, `react`, `react-dom`, `@types/react`), taking patch-only for
community `react-native-*` modules, and renaming the group to
`sdk-independent-updates`, which is what it actually contains. Those packages
move only through a deliberate SDK upgrade with `npx expo install --fix`.

Caveat worth stating: `ignore` rules also suppress Dependabot *security* PRs for
those packages. The npm audit posture for the Expo/RN tree is already tracked
separately — the remaining advisories need an unsafe Expo major upgrade and are
documented in the plan's Phase 9 — so this does not hide anything that was being
acted on. It does mean an RN advisory will arrive through `npm audit`, not as a
PR.

## Cause 2 — the CodeQL action was split across PRs

`init`, `autobuild`, and `analyze` are one product and must move together.
Bumping one alone fails outright:

```
##[error]Loaded a configuration file for version '3.37.3', but running version '4.37.3'
```

That is PR #28's failure verbatim; #26 is the mirror image. Neither can go green
on its own, and merging one leaves `main` broken until the other lands.

Fixed with a `codeql-action` group matching `github/codeql-action*` in the
github-actions ecosystem, so the next run proposes all three in a single PR.

Note that v3 is not currently broken — this is version churn, not a security
fix. The runner's Node 20 deprecation warning is the standing reason to take v4
eventually, and the grouped PR will make that a one-click change.

## What to do

1. Merge this branch, then close #34, #33, #32, #31, #30, #28, #26. The
   corrected config reopens what still applies on the next scheduled run
   (npm: Mondays 13:00 America/Chicago; actions: monthly).
2. #27 (`actions/checkout` → v7) is safe to merge: checks pass and the SHA pin
   with its version comment is preserved.
3. Wanted updates currently trapped inside #30 — `@supabase/supabase-js`
   2.100.1 → 2.110.9, `date-fns` 4.1.0 → 4.4.0, `playwright` 1.58.2 → 1.62.0,
   `country-flag-icons` — will return in the next `sdk-independent-updates` PR
   without the React Native bump attached.

Nothing here was merged or closed on Dan's behalf; PRs are outward-facing repo
state.
