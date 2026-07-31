# CodeQL alert triage — 2026-07-31

Closes the plan's open item *"Triage 17 untriaged `js/file-access-to-http`
alerts in probe scripts."* The item's premise was wrong, so this triage covers
the real alert set instead.

## The count in the plan was stale

`docs/plans/founder-security-hardening-plan-2026-07-29.md` records **20 open
alerts, 17 pre-existing**. That was a snapshot taken while the first scan of
`main` was still running. Measured today:

```
gh api "repos/Twofers/app/code-scanning/alerts?state=open&per_page=100" --jq 'length'
81
```

**81 open, 0 dismissed** — 17 high and 64 medium, across 10 rules. The
`security-extended` query suite is broader than the default, which accounts for
most of the volume.

| Rule | Severity | Count |
| --- | --- | ---: |
| `js/file-access-to-http` | medium | 60 |
| `js/regex/missing-regexp-anchor` | high | 7 |
| `js/incomplete-sanitization` | high | 3 |
| `js/clear-text-logging` | high | 2 |
| `js/disabling-certificate-validation` | high | 2 |
| `js/http-to-file-access` | medium | 2 |
| `js/stack-trace-exposure` | medium | 2 |
| `js/bad-tag-filter` | high | 1 |
| `js/file-system-race` | high | 1 |
| `js/incomplete-url-substring-sanitization` | high | 1 |

Grouped by what the code actually is:

| Where | Alerts | Ships to users? |
| --- | ---: | --- |
| `scripts/**` — developer/CI probes and evaluators | 70 | No |
| `**/*.test.ts` — vitest source-contract tests | 8 | No |
| `website/admin/qrcode-browser.js` — vendored bundle | 1 | Yes (admin console) |
| `supabase/functions/_shared/site-import.ts` | 1 | **Yes** |
| `supabase/functions/_shared/business-onboarding-sync.ts` | 1 | **Yes** |

Two alerts were in code that runs in production. Both were real. Both are fixed.

## Fixed: `js/bad-tag-filter` — `site-import.ts:570`

`htmlToMenuText` reduces a merchant's fetched web page to text for the
menu-structuring LLM, dropping `<script>` blocks on the way. The filter required
the end tag to be exactly `</script>`. An HTML parser also accepts
`</script >`, `</script\n>`, `</script/>`, and `</script foo="bar">`, so a page
using any of those kept its script body in the extracted text.

Measured, before and after, on `<script>INJECTED_PAYLOAD</script ><p>Latte $5</p>`:

```
OLD  -> "INJECTED_PAYLOAD Latte $5"
NEW  -> "Latte $5"
```

Why it matters here: the page is chosen by the merchant and served by a host we
do not control, and the extracted text goes straight into an LLM prompt whose
output is written to the business's menu. Script contents surviving the filter
is a prompt-injection channel, not just noise. It is not XSS — the tag stripper
still removes the angle brackets, so nothing reaches a renderer as markup.

The fix accepts attributes and whitespace in the end tag (`<\/script\b[^>]*>`)
for `script`, `style`, and `noscript`, moves comment stripping ahead of the tag
passes, and drops the remainder of the document after an *unterminated* block —
previously the tag stripper would have removed only that tag's brackets and kept
its body. Truncating is the fail-closed direction: the worst case is less menu
text.

Regression tests: `site-import.test.ts` covers all five end-tag spellings,
style/noscript, the unterminated block, and a commented-out `<script>` that must
not swallow the page.

## Fixed: `js/incomplete-url-substring-sanitization` — `business-onboarding-sync.ts:78`

`normalizeUrlOrHandle` decided "is this an Instagram link or a website?" with
`lower.includes("instagram.com")`, which also matches
`https://evil.example/instagram.com/joes` and
`https://instagram.com.evil.example/joes`.

Impact is low and was checked rather than assumed: the result is written to
`business_contact_channels` and read by the admin prospect console. It is not
fetched (the site importer does its own `validateImportUrl` + same-host check)
and not rendered as a link in the app. The realistic outcome is an unrelated
host filed under a merchant's Instagram channel — misleading, not exploitable.

Fixed anyway, because the correct check is three lines: parse the value (adding
`https://` when it has no scheme) and require the hostname to be `instagram.com`
or a subdomain. New `business-onboarding-sync.test.ts` pins both directions —
real Instagram URLs still classify as Instagram, the four confusable shapes now
classify as websites, and `@handle` / bare-domain / empty behaviour is unchanged.

## Not defects: the other 79

| Group | Rules | Disposition |
| --- | --- | --- |
| `scripts/**` reading `.env` and calling the project's own APIs | `js/file-access-to-http` ×60 | The flagged flow — credentials read from a file reach an HTTP request — is exactly what a probe script does. Destinations are hard-coded constants (`api.backblazeb2.com`, the Supabase project URL), so file contents cannot redirect where data is sent. |
| `evaluate-ad-copy-naturalness.mjs` writing its report | `js/http-to-file-access` ×2 | The output path comes from the operator's CLI argument via `path.dirname(corpusPath)`; the HTTP response supplies only file *contents*. The traversal the rule models is not reachable. |
| `evaluate-*.mjs` markdown table cells | `js/incomplete-sanitization` ×2 | `cell()` escapes `\|` but not `\\` when building a local markdown report. Cosmetic. |
| `e2e-smoke.js`, `check-website-ui-crawl.js` | `js/stack-trace-exposure` ×2 | `err.stack` printed to a local CLI console. No HTTP response is involved. |
| `probe-rls-inventory.mjs`, `smoke-admin-ai-staging.mjs` | `js/clear-text-logging` ×2 | What is logged is the public project URL and an already-redacted email — not a secret. |
| `scripts/security/verify-database-tls.mjs` | `js/disabling-certificate-validation` ×1 | Deliberate and documented: the probe's job is to observe an unverified handshake, and it sends no password. |
| `scripts/security/pg-read.mjs` | `js/disabling-certificate-validation` ×1 | Already remediated on 2026-07-29 — it verifies by default and refuses to send a password otherwise. The alert flags the surviving `PG_READ_INSECURE_TLS=true` opt-in branch. |
| `*-source.test.ts` | `js/regex/missing-regexp-anchor` ×7 | These tests read a production source file and assert on its text; CodeQL reads assertions like `/api\.resend\.com\/emails/` as unanchored URL validation. No URL is validated. |
| `prospect-command-center-source.test.ts` | `js/file-system-race` ×1 | `statSync` then `readFileSync` in a test helper walking the repo. |
| `website/admin/qrcode-browser.js` | `js/incomplete-sanitization` ×1 | Vendored browserify bundle of the `qrcode` library; the flagged line is inside the library's own regex handling. |

## Finding: inline `// codeql[...]` comments do nothing

The 2026-07-29 pass annotated two files with `// codeql[js/...]` suppression
comments. **GitHub code scanning ignores those for JavaScript/TypeScript** —
both files still carry open alerts (82 and 83). That syntax belongs to CodeQL's
own query-test harness, not to code scanning. The only real mechanisms are
dismissing an alert through the UI/API, or excluding the path from analysis.

Worth knowing generally: an annotation that reads like a control but silences
nothing is worse than no annotation, because the next reader assumes it was
handled. The comments are kept — they explain *why* the code is deliberate —
but they are documentation, not suppression.

## Change: stop scanning code that cannot ship

New `.github/codeql/codeql-config.yml`, referenced from the workflow's `init`
step, excludes `scripts/**`, `**/*.test.ts(x)`, and the vendored qrcode bundle.
Everything a user can reach — the Expo app, the website, and the Edge Functions
— stays in scope.

The reasoning is signal, not tidiness. With 79 permanent non-defects sitting
open, the next genuine alert arrives as number 80 in a list nobody reads. After
this change the expected steady state is zero open alerts, so one appearing
means something.

The tradeoff, stated plainly: a genuinely dangerous developer script will no
longer be flagged here. Compensating controls are that nothing under `scripts/`
is bundled or deployed, and gitleaks CI still scans every commit for credential
leakage. Excluding paths in a committed, reviewable file was preferred over
dismissing 79 alerts through the API, where the decision would live only in
dashboard state.

The 79 excluded alerts close automatically once the config reaches `main` —
CodeQL closes alerts in files it no longer analyzes. No manual dismissal is
required, and nothing needs to be dismissed on Dan's behalf.

## Verification

- `npm test` — 314 files, 2178 tests, all passing, including 11 new ones.
- The two fixed files are Edge Function `_shared` code; **neither is deployed
  yet.** `import-business-website`, `update-business-profile-section`, and the
  onboarding functions still run the old copies in production. Deploying them is
  a separate approval.
- The CodeQL config takes effect on the next scan after it reaches `main`.

## Left for Dan

1. Merge this branch (repository-control changes are `[DAN]` by the plan's own
   rule).
2. Deploy the two `_shared` consumers, or leave them — the exposure is a
   prompt-injection channel on merchant-supplied pages, not a data leak, and it
   has been present since the site importer shipped.
