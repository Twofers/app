# Dependency security triage — 2026-07-29

## npm result

The production audit measured **1 critical, 63 high, 9 moderate (73 total)**
before the non-breaking remediation. `npm audit fix --omit=dev` cleared the
critical issue and left **0 critical, 59 high, 10 moderate (69 total)**.
Including development dependencies reports 77 total (1 low, 10 moderate,
66 high).

No `--force` remediation was used. The remaining suggested fixes require a
breaking move to React Native 0.86 and/or Expo 57. That upgrade must be a
separate compatibility project with device, native-build, and store-release
testing; it is not safe to smuggle into a security patch.

The lockfile now carries the compatible transitive updates. CI must continue to
use `npm ci`, and Dependabot is configured for reviewable weekly npm updates.

## Deno / Edge imports

The Edge runtime is outside npm-audit coverage:

| Import family | Current control | Disposition |
|---|---|---|
| Deno standard library | Exact `0.168.0` URLs plus `deno.lock` integrity hashes | Pinned |
| Stripe | Exact `14.19.0` esm.sh URL plus lock hash | Pinned |
| QRCode, fflate, node-forge | Exact versions | Pinned |
| Supabase JS | Source uses major alias `@2`; `deno.lock` redirects it to exact `2.108.0` with SHA-256 integrity | Accept while deployments honor the committed lock; verify this in the deploy command |

Before any future Edge deploy, review the `deno.lock` diff. A redirect or hash
change without an intentional dependency update is a release blocker.

## Dependabot alerts surfaced 2026-07-31

Two open Dependabot alerts on `main` (1 moderate, 1 low), surfaced when the
`security/web-attack-hardening-2026-07-31` branch was pushed. Both were traced to
their dependency path and code usage; **neither is exploitable in this project's
usage, and neither ships to production** (app bundle or Edge Functions).

| Alert | Sev | Installed → patched | Dependency path | Usage & disposition |
|---|---|---|---|---|
| `uuid` GHSA-w5hq-g745-h8pq — missing buffer bounds check in v3/v5/v6 when a `buf` arg is supplied | Moderate | `7.0.3` → `11.1.1` | `expo → @expo/config-plugins → xcode → uuid` | **iOS build tooling** (Xcode project UUID generation during `expo prebuild`), not app runtime. Our source imports `uuid` nowhere; `xcode` never passes an attacker-controlled `buf`. Vulnerable path unreachable. **Accept.** |
| `esbuild` GHSA-g7r4-m6w7-qqqr — dev server allows arbitrary file read (CORS) on Windows | Low | `0.27.4` → `0.28.1` | `vitest → vite → esbuild` | **Test/dev dependency**. Used only as vitest/vite's bundler; we never run `esbuild serve` as a network-exposed dev server. Not the vulnerable mode. **Accept.** |

### Why not force the fixes

Both patches are blocked behind upstream pins: `xcode@3.0.1` expects the uuid-7
API and is incompatible with the ESM-only uuid 11; `vite@7.3.5` pins esbuild
0.27.x. Adding npm `overrides` to cross those majors would risk breaking the iOS
prebuild (uuid) and the test runner (esbuild) — a real regression to close two
non-exploitable, non-production alerts. They will clear naturally when Expo and
Vite bump, which the weekly Dependabot config already tracks. No `overrides`
added; no `--force` used.

### Founder action to clear the dashboard

These are transitive and not dismissible via repository files. To stop them
showing as open on the GitHub Security tab, dismiss each with reason
**"Vulnerable code is not actually used"** (Dependabot alerts → alert →
Dismiss). Re-evaluate if either package ever becomes a direct dependency or is
used with the vulnerable API.
