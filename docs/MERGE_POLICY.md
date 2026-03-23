# Merge policy

## English regression

Automated **English regression** tests live in `lib/deal-quality.english-regression.test.ts` and validate publish-time **deal quality** behavior for **English** listing copy.

- **Run locally:** `npm run test:english` (or `npm test` for the full Vitest run).
- **CI:** `.github/workflows/english-regression.yml` runs on pushes and pull requests targeting `main`, `protect/**`, and `chore/**` branches.

**Do not merge** changes that break English regression until:

1. `npm run test:english` passes locally, and  
2. the **English regression** GitHub Actions job is green on the PR.

This does not replace manual QA; it locks in expected behavior for the current English heuristics.

## Baseline branch

The branch `protect/deal-quality-baseline` holds a snapshot of deal-quality and related work. Major refactors should either keep regression green or update tests **intentionally** with product sign-off.
