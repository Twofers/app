# Viewer Language Invariant Plan

Date: 2026-07-03

Scope: this plan defines the stricter product rule for multilingual deals after Spanish and Korean rollout signoff. It does not deploy code, apply migrations, enable hosted flags, build release artifacts, or approve production rollout.

## Product Invariant

Customer display language is controlled by the viewer, not by the business authoring language.

Every deal has three separate language concepts:

- `source_locale`: the language the business used while creating the deal.
- Canonical deal facts: language-neutral structured facts such as offer type, required item, reward item, discount percent, schedule, limits, location, and redemption rules.
- `viewer_locale`: the logged-in user's app or preferred deal language.

Customer-facing deal and ad surfaces must render in `viewer_locale`. `source_locale` is input history only and must not be used as a customer display fallback unless it matches `viewer_locale`.

| Source locale | English viewer | Spanish viewer | Korean viewer |
| --- | --- | --- | --- |
| `en-US` | English | Spanish | Korean |
| `es-US` | English | Spanish | Korean |
| `ko-KR` | English | Spanish | Korean |

## Allowed Exceptions

The protected-term policy still applies. These values may remain as entered unless the merchant has provided an approved localized name:

- Business names.
- Branded or trademarked item names.
- Merchant-provided do-not-translate terms.
- Addresses, emails, phone numbers, URLs, claim codes, QR payloads, redemption codes, and technical identifiers.

Everything else that the app controls is language-owned by `viewer_locale`: offer lines, titles, descriptions, poster text, CTA labels, empty states, errors, schedules, share copy, push text, accessibility labels, and image alt text.

## Display Fallback Order

For every customer-visible deal surface:

1. Use the approved localization row for `viewer_locale` when present, approval-bound, and QA-passing.
2. Else render deterministic customer copy for `viewer_locale` from canonical deal facts.
3. Else show a localized unavailable/repair state in `viewer_locale`.

Do not fall back to `source_locale` customer copy. Do not fall back to English for Spanish or Korean viewers. Do not fall back to Spanish or Korean for English viewers.

## Required Surface Coverage

The invariant applies to all of these surfaces:

- Home feed cards.
- Map preview cards.
- Business profile deal cards.
- Deal detail.
- Wallet active and ended rows.
- Visual pass and QR fallback screens.
- Share Deal sheet copy.
- Share Deal public landing pages and deep-link fallback pages.
- Poster canvas and poster live strip.
- Standard card/composed ad previews.
- Redeem and redemption mode screens when a deal title is displayed.
- Reuse/template screens that show past deal titles.
- Deal analytics titles and exported labels when shown in-app.
- Report sheets and customer support flows that include deal context.
- Push notifications, including deal release pushes, weekly digests, local reminders, and owner claim/sold-out pushes where a deal title appears.
- Accessibility labels, hints, image alt text, and screen-reader-only text.
- API, auth, Edge Function, Supabase, network, and validation errors.

## Source-Locale Matrix Gate

Automated tests must cover the full 3 by 3 language matrix:

- English source deal viewed by English, Spanish, and Korean users.
- Spanish source deal viewed by English, Spanish, and Korean users.
- Korean source deal viewed by English, Spanish, and Korean users.

Each matrix should include:

- Percent-off single item.
- Same-item free offer.
- Cross-item free offer.
- Long item name.
- Protected English brand name.
- Protected Spanish item name.
- Protected Hangul item name.
- Missing provider transcreation with deterministic fallback.
- QA-blocked transcreation.
- Legacy deal with incomplete localized fields.

The tests should assert that app-controlled text is in `viewer_locale` and contains no source-language leak outside protected terms.

## Publish And Approval Gates

Publishing should require one of these for every enabled locale:

- Approved, hash-bound localization row with QA decision `pass` or `not_required`.
- Deterministic localized rendering from structured deal facts.

If neither is available for a locale, the deal can save as a draft but should not publish broadly to customers in that locale. If only a subset of locales is publishable, customer distribution must be restricted to those locales or publishing must be blocked.

## Push Policy Change

The prior PR4 policy intentionally excluded multilingual push. That policy conflicts with the viewer-language invariant.

Before broad production use of this invariant, push must be updated so:

- Customer push text is generated or deterministically rendered in each recipient's locale.
- Weekly digest text is localized per recipient locale.
- Deal release push copy does not use source-language or English fallback for non-English recipients.
- Owner-facing push uses the business owner's preferred locale, with localized deal title when available.
- If recipient locale cannot be resolved or localized push copy cannot be built, the push is skipped or replaced with a generic localized notification for that recipient locale.

## Share Deal Policy

Share Deal has two viewer-language surfaces and both must satisfy the invariant:

- Sender surface: the native share sheet title/message should render in the sender's current app language and use the sender's localized deal title.
- Recipient surface: opening a shared link should render the deal in the recipient's app language after the app opens. If the recipient lands on a public web/open-app fallback page first, that page should use the recipient's browser/app language when available and provide only localized generic copy.

Current implementation notes:

- `lib/share-deal.ts` localizes the share message shell through `shareDeal.message` and `shareDeal.shareSheetTitle`.
- `app/deal/[id].tsx` and `app/(tabs)/wallet.tsx` pass localized display titles into `buildShareCopy()`.
- `components/deal-deeplink-handler.tsx` resolves `/s/<code>` links and routes to `/deal/[id]`, where the app can render the recipient's viewer locale.
- Local code now updates `supabase/functions/deal-link/index.ts` to resolve `lang`/`Accept-Language`, render localized public-safe copy, and use a localized generic fallback instead of raw source titles. Production still requires approved Edge redeploy.

Implementation requirements:

- `buildShareCopy()` must never receive raw `title`/`description` from a deal row on customer paths; callers must pass `buildLocalizedDealDisplay(...).title`.
- Share links should not encode the business source language as the display language.
- Public landing pages should resolve display locale from, in order: explicit safe `lang` query parameter if present, `Accept-Language`, then product default; signed-in app rendering still uses the app/user profile language.
- Public landing pages should use approved localization storage or deterministic localized rendering for the selected locale. If unavailable, show a localized unavailable state instead of source-language deal copy.
- Share-sheet error text, unavailable-link modals, accessibility labels, QR modal share prompts, and fallback webpage buttons all count as Share Deal text.
- Add source guards that fail if Share Deal callers pass raw `deal.title`, if `deal-link` returns hard-coded English page text for localized routes, or if the fallback page uses `getDealDisplayTitle()` without viewer-locale localization.

## Strict Fallback Gate

Add a local/CI gate that fails customer-visible code paths when it finds:

- `english_fallback` used as a customer display outcome for non-English viewers.
- `source_locale_fallback` used as a customer display outcome when it differs from `viewer_locale`.
- `return raw` or unstructured API error pass-through for non-English UI.
- Hard-coded English visible text outside locale files.
- `t(..., { defaultValue: "English text" })` on customer-visible screens without matching locale-file coverage.
- Direct use of legacy `title`, `description`, `title_en`, `title_es`, or `title_ko` in customer surfaces without `buildLocalizedDealDisplay`.
- Push builders that do not take recipient locale.

Developer-only comments, type names, telemetry enum values, database column names, and internal logs are not user-facing leaks unless rendered in app UI.

## Visual And Native QA

Screenshot QA should capture representative customer paths for each viewer locale, not just each source locale. OCR or source-string scanning should flag unapproved source-language text in:

- Cards.
- Deal detail.
- Wallet.
- Poster preview.
- Share sheet pre-copy where possible.
- Redeem/pass flows.
- Error states.

Native reviewer signoff must be renewed for any newly localized surfaces, especially push, share copy, poster text, and strict fallback/unavailable states.

## Acceptance Standard

A logged-in customer using English, Spanish, or Korean should be able to browse, claim, use, share, report, and view deal history without seeing app-controlled text in the wrong language.

The business authoring language must never decide what a customer sees. It only records how the deal was created.
