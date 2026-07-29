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
