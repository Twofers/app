import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DISABLE_TYPELESS_WARNING = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";
if (!process.execArgv.includes(DISABLE_TYPELESS_WARNING) && !process.env.TWOFER_COPY_EVAL_REEXEC) {
  const child = spawnSync(process.execPath, [
    ...process.execArgv,
    DISABLE_TYPELESS_WARNING,
    fileURLToPath(import.meta.url),
    ...process.argv.slice(2),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, TWOFER_COPY_EVAL_REEXEC: "1" },
    stdio: "inherit",
  });
  if (child.error) {
    console.error(child.error.message);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}

const {
  buildCanonicalHeadlineFromFacts,
  buildDealOfferContract,
} = await import("../lib/deal-offer-contract.ts");
const { validateDealEligibility } = await import("../lib/deal-eligibility.ts");
const { buildOfferDefinitionV1FromContract } = await import("../lib/offer-definition.ts");
const {
  buildPosterCopyFromOfferDefinition,
  buildPosterOfferLinesFromOfferDefinition,
} = await import("../lib/poster/posterCopy.ts");
const { copyOnlyRevisionTargetForFeedback } = await import("../lib/ai-revision-target.ts");
const { resolveLocalizedOfferTerm, hasVerifiedLocalizedName } = await import("../lib/localized-offer-terms.ts");
const { buildLocalizedDealDisplay } = await import("../lib/localized-deal-display.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "fixtures", "ai-promotional-copy-offers.json");
const posterFixturePath = path.join(root, "fixtures", "ai-poster-copy-offers.json");
const revisionFixturePath = path.join(root, "fixtures", "ai-revision-feedback-cases.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const posterFixtures = JSON.parse(fs.readFileSync(posterFixturePath, "utf8"));
const revisionFixtures = JSON.parse(fs.readFileSync(revisionFixturePath, "utf8"));

function clean(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function stripArticle(value) {
  return clean(value).replace(/^(?:a|an|the)\s+/i, "");
}

function normalizedItem(value) {
  return stripArticle(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ies\b/g, "y")
    .replace(/s\b/g, "");
}

function sameItem(a, b) {
  return normalizedItem(a) === normalizedItem(b);
}

// Generalized regression check for the 2026-08-05 fitLocalizedItem fix: an item with no
// dictionary translation for a locale (`!hasVerifiedLocalizedName`) still renders in the
// ORIGINAL English text there — see resolveLocalizedOfferTerm's preserved-term fallback.
// English is head-final, so trimming that text must never drop its LAST word (the head
// noun): "12 ounce bag of whole bean coffee" -> "12 OUNCE BAG OF WHOLE" lost "coffee"
// entirely without leaving a dangling connector at all, which is why the existing
// DANGLING_RE_BY_LOCALE checks below did not already catch this bug shape. Requiring the
// head word to survive is independent of which trimming algorithm produced the line, so it
// generalizes to any future untranslated item, not just this fixture.
function lastWord(value) {
  const words = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words[words.length - 1] ?? "";
}

function containsWord(haystack, word) {
  if (!word) return true;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

function newHeadline(fixture) {
  return buildCanonicalHeadlineFromFacts({
    merchantName: fixture.merchantName ?? "Test Merchant",
    buyQuantity: Number(fixture.buyQuantity ?? 1),
    buyItem: fixture.buyItem,
    rewardQuantity: Number(fixture.rewardQuantity ?? 1),
    rewardItem: fixture.rewardItem,
    rewardType: fixture.rewardType,
    rewardValue: fixture.rewardValue,
    claimLimit: fixture.claimLimit,
  });
}

function oldHeadline(fixture) {
  if (fixture.rewardType === "percent_off") return `${fixture.rewardValue}% off ${fixture.buyItem}`;
  if (sameItem(fixture.buyItem, fixture.rewardItem)) return `Buy one ${fixture.buyItem}, get one free`;
  return `${fixture.buyItem} with free ${fixture.rewardItem}`;
}

function validate(fixture, headline) {
  const errors = [];
  const lower = headline.toLowerCase();
  if (!/^(buy|get|order|save|claim)\b/i.test(headline)) errors.push("missing_action_start");
  if (/\bwith\s+free\b/i.test(headline)) errors.push("with_free_fragment");
  if (fixture.rewardType === "percent_off") {
    if (!lower.includes(String(fixture.rewardValue))) errors.push("missing_percent");
    if (!lower.includes(clean(fixture.buyItem).toLowerCase())) errors.push("missing_item");
  } else {
    if (!lower.includes(stripArticle(fixture.buyItem).toLowerCase())) errors.push("missing_buy_item");
    if (!lower.includes(stripArticle(fixture.rewardItem).toLowerCase())) errors.push("missing_reward_item");
  }
  if (headline !== fixture.preferredHeadline) errors.push("differs_from_preferred");
  return errors;
}

function dealEligibilityForPosterFixture(fixture) {
  if (fixture.rewardType === "percent_off") {
    return {
      dealType: "PERCENT_OFF_SINGLE_ITEM",
      appliesTo: "SINGLE_ITEM",
      discountPercent: fixture.rewardValue,
      itemDescription: fixture.buyItem,
      itemRetailValueCents: 1000,
    };
  }

  return {
    dealType: sameItem(fixture.buyItem, fixture.rewardItem)
      ? "BUY_ONE_GET_ONE_FREE"
      : "BUY_ONE_GET_SOMETHING_FREE",
    appliesTo: "SINGLE_ITEM",
    requiredPurchaseQuantity: fixture.buyQuantity ?? 1,
    requiredItemDescription: fixture.buyItem,
    requiredItemRetailValueCents: 1000,
    freeItemQuantity: fixture.rewardQuantity ?? 1,
    freeItemDescription: fixture.rewardItem,
    freeItemRetailValueCents: 500,
    freeItemDiscountPercent: 100,
  };
}

function posterDefinitionForFixture(fixture) {
  const dealEligibility = dealEligibilityForPosterFixture(fixture);
  const eligibilityResult = validateDealEligibility(dealEligibility);
  const contract = buildDealOfferContract({
    businessId: `fixture_${fixture.id}`,
    businessName: fixture.merchantName ?? "Fixture Merchant",
    locationId: `fixture_${fixture.id}_location`,
    locationName: fixture.merchantName ?? "Fixture Merchant",
    dealEligibility,
    eligibilityResult,
    activeWindowHumanReadable: "Today",
    quantityLimit: 25,
  });
  if (!contract) throw new Error(`Could not build poster contract for ${fixture.id}`);
  return buildOfferDefinitionV1FromContract(contract, {
    schedule: {
      startAt: "2026-06-29T09:00:00Z",
      endAt: "2026-06-29T11:00:00Z",
      timezone: "America/Chicago",
    },
  });
}

function buildPosterCopy(fixture, headline, subline = null) {
  return buildPosterCopyFromOfferDefinition({
    definition: posterDefinitionForFixture(fixture),
    headline,
    subline,
    businessCategory: fixture.businessCategory,
  });
}

function validatePosterFixture(fixture) {
  const errors = [];
  const base = buildPosterCopy(fixture, null);
  if (base.offer_line_1 !== fixture.expectedOfferLine1) errors.push("offer_line_1_changed");
  if (base.offer_line_2 !== fixture.expectedOfferLine2) errors.push("offer_line_2_changed");
  if (fixture.expectedPosterKicker) {
    const copy = buildPosterCopy(fixture, fixture.expectedPosterHeadline, fixture.expectedPosterKicker);
    if (copy.subline !== fixture.expectedPosterKicker) {
      errors.push(`poster_kicker_changed:${fixture.expectedPosterKicker}`);
    }
  }
  for (const rejected of fixture.rejectedHeadlines ?? []) {
    const copy = buildPosterCopy(fixture, rejected);
    if (copy.headline !== fixture.expectedPosterHeadline) {
      errors.push(`accepted_weak_headline:${rejected}`);
    }
  }
  return errors;
}

// Ported from the gitignored S1 post-deploy smoke
// (artifacts/poster-quality/2026-07-20-run2/harness/smoke-s1.mjs), which existed because the
// GRATIS-deletion and dangling-determiner bugs are invisible in English: a stale-code deploy
// looked fine on every surface anyone normally checks, so English regressing was never the
// risk — Spanish silently regressing was. Generalized here to run against every poster
// fixture in BOTH locales, independent of and in addition to the en-US-only assertions above,
// so any future change to the offer-line composer trips this without a dedicated smoke run.
const FREE_WORD_BY_LOCALE = { "es-US": "GRATIS", "ko-KR": "무료" };
// es-US: the exact denylist from smoke-s1 (S1/S3's observed live failures — "AL COMPRAR 1
// CUALQUIER", "...SANDWICH DE") plus the rest of posterCopy.ts's own ES_TRAILING_FUNCTION_WORDS
// set, duplicated independently on purpose: a regression test should not trust the
// implementation it is pinning.
const ES_DANGLING_RE =
  /\s(DE|DEL|CON|Y|A|AL|EN|PARA|TU|SU|LA|EL|LOS|LAS|UN|UNA|UNOS|UNAS|TUS|SUS|MI|MIS|CUALQUIERA?)$/i;
// ko-KR has no documented dangling-particle bug, but "never end on a determiner/connector"
// generalizes as: a Korean offer line must never trail off on a bare LEFTOVER English
// connector/stop word either (the shape this whole bug family takes) — which would mean an
// untranslated item name was truncated by the wrong locale's fitter.
const KO_DANGLING_RE = /\s(AND|OR|PLUS|WITH|OF|A|AN|THE|ONE|YOUR|ANY)$/i;
const DANGLING_RE_BY_LOCALE = { "es-US": ES_DANGLING_RE, "ko-KR": KO_DANGLING_RE };
const LOCALE_SUFFIX = { "es-US": "Es", "ko-KR": "Ko" };

// Classic 1-for-1 same-item BOGO states its value as "2 FOR 1" / "2 POR 1" / a Korean
// counter phrase, never the word free/GRATIS/무료, in ANY locale (including en-US's
// own "2 FOR 1" offer_line_1) — that is correct, existing, intentional copy, not a
// regression. The free-word assertion below only applies once the reward is stated as an
// actual "free <item>", which is every other shape (a different reward item, or a same-item
// reward at non-classic quantities).
function isClassicSameItemBogo(fixture) {
  return (
    fixture.rewardType !== "percent_off" &&
    sameItem(fixture.buyItem, fixture.rewardItem) &&
    (fixture.buyQuantity ?? 1) === 1 &&
    (fixture.rewardQuantity ?? 1) === 1
  );
}

function validatePosterLocaleFixture(fixture) {
  const errors = [];
  const statesFreeReward = fixture.rewardType !== "percent_off" && !isClassicSameItemBogo(fixture);
  const rewardSourceItem =
    fixture.rewardType === "percent_off" ? fixture.buyItem : fixture.rewardItem ?? fixture.buyItem;
  for (const locale of ["es-US", "ko-KR"]) {
    const lines = buildPosterOfferLinesFromOfferDefinition(posterDefinitionForFixture(fixture), locale);
    const suffix = LOCALE_SUFFIX[locale];
    const expected1 = fixture[`expectedOfferLine1${suffix}`];
    const expected2 = fixture[`expectedOfferLine2${suffix}`];
    if (expected1 != null && lines.offer_line_1 !== expected1) {
      errors.push(`offer_line_1_${locale}_changed:${lines.offer_line_1}`);
    }
    if (expected2 != null && lines.offer_line_2 !== expected2) {
      errors.push(`offer_line_2_${locale}_changed:${lines.offer_line_2}`);
    }
    if (statesFreeReward) {
      const combined = `${lines.offer_line_1} ${lines.offer_line_2}`;
      if (!combined.includes(FREE_WORD_BY_LOCALE[locale])) {
        errors.push(`missing_free_word_${locale}:${combined}`);
      }
    }
    const dangling = DANGLING_RE_BY_LOCALE[locale];
    for (const [field, value] of [["offer_line_1", lines.offer_line_1], ["offer_line_2", lines.offer_line_2]]) {
      if (dangling.test(value)) {
        errors.push(`dangling_connector_${locale}_${field}:${value}`);
      }
    }
    const combinedLines = `${lines.offer_line_1} ${lines.offer_line_2}`;
    const buyTerm = resolveLocalizedOfferTerm({ sourceDisplayName: fixture.buyItem ?? "", locale });
    if (!hasVerifiedLocalizedName(buyTerm)) {
      const word = lastWord(fixture.buyItem);
      if (!containsWord(combinedLines, word)) {
        errors.push(`head_noun_lost_${locale}_buyItem:${combinedLines}`);
      }
    }
    const rewardTerm = resolveLocalizedOfferTerm({ sourceDisplayName: rewardSourceItem ?? "", locale });
    if (!hasVerifiedLocalizedName(rewardTerm)) {
      const word = lastWord(rewardSourceItem);
      if (!containsWord(combinedLines, word)) {
        errors.push(`head_noun_lost_${locale}_rewardItem:${combinedLines}`);
      }
    }
  }
  return errors;
}

// S13 (commit 6b4bf333, lib/localized-deal-display.ts): buildLocalizedDealDisplay's
// customer description was joined from three paraphrases of the same offer — the AI
// supporting copy, the deterministic primary offer line and the terms line — and the
// old join only dropped EXACT duplicates, so a live deal read the offer twice with the
// two sentences run together ("...of your choice Purchase any large c…"). The fix
// (joinUniqueText/alreadySaid) drops any part whose significant (>2-char, CJK->=2-char)
// tokens are >=60% covered by an earlier kept part, and sentence-terminates every kept
// part. This probe reconstructs that exact three-part join for every poster fixture in
// every supported locale, so any future change to joinUniqueText/alreadySaid or to the
// localized offer renderer trips it without a dedicated repro. Nothing here is
// hand-authored per fixture: the "paraphrase" is built by discovering the fixture's own
// REAL deterministic primaryOfferLine first (one flagless buildLocalizedDealDisplay
// call) and wrapping that exact line in generic lead-in/trail-off text, which — like the
// live AI supporting copy that triggered S13 — carries every content word of the offer
// line it restates without being byte-identical to it (so this exercises the >=60%
// TOKEN-OVERLAP path added by S13, not the pre-existing exact-match path).
const S13_PROBE_LOCALES = ["en-US", "es-US", "ko-KR"];

function s13DealFromPosterFixture(fixture, overrides = {}) {
  const eligibility = dealEligibilityForPosterFixture(fixture);
  const base = {
    id: `s13_${fixture.id}`,
    business_id: `s13_biz_${fixture.id}`,
    deal_type: eligibility.dealType,
    applies_to: eligibility.appliesTo,
    discount_percent: eligibility.discountPercent ?? null,
    item_description: eligibility.itemDescription ?? null,
    item_retail_value_cents: eligibility.itemRetailValueCents ?? null,
    required_purchase_quantity: eligibility.requiredPurchaseQuantity ?? null,
    required_item_description: eligibility.requiredItemDescription ?? null,
    required_item_retail_value_cents: eligibility.requiredItemRetailValueCents ?? null,
    free_item_quantity: eligibility.freeItemQuantity ?? null,
    free_item_description: eligibility.freeItemDescription ?? null,
    free_item_retail_value_cents: eligibility.freeItemRetailValueCents ?? null,
    free_item_discount_percent: eligibility.freeItemDiscountPercent ?? null,
    customer_value_percent: 50,
    max_claims: 25,
    start_time: "2026-06-29T09:00:00Z",
    end_time: "2026-06-29T11:00:00Z",
    timezone: "America/Chicago",
    businesses: {
      name: fixture.merchantName ?? "Fixture Merchant",
      location: `${fixture.id} Test Plaza`,
    },
  };
  return { ...base, ...overrides };
}

function validateS13RestatementGuardFixture(fixture, locale) {
  const errors = [];
  const bare = buildLocalizedDealDisplay({
    deal: s13DealFromPosterFixture(fixture),
    locale,
    localeResolutionSource: "app_language",
    useLocalizedOfferRenderer: true,
    fallbackLanguage: "en",
  });
  const primaryOfferLine = clean(bare.lockedOfferContent?.primaryOfferLine);
  if (!primaryOfferLine) {
    errors.push("no_primary_offer_line");
    return errors;
  }

  const locationMarker = `${fixture.id} Test Plaza`;
  const supportingCopy = `Here's the deal: ${primaryOfferLine.replace(/[.!?]+$/, "")} today.`;
  const display = buildLocalizedDealDisplay({
    deal: s13DealFromPosterFixture(fixture, {
      customer_deal_localization: {
        dealId: `s13_${fixture.id}`,
        offerVersionId: `s13_offer_${fixture.id}`,
        locale,
        sourceLocale: locale,
        headline: "S13 probe headline",
        supportingCopy,
        localizationHash: `adlocrow_s13_${fixture.id}`,
        localizationBundleHash: `adloc_s13_${fixture.id}`,
        translationStatus: "source_creative",
        qaDecision: "pass",
        qaReasonCodes: [],
        deterministicFallback: false,
      },
    }),
    locale,
    localeResolutionSource: "app_language",
    useLocalizedOfferRenderer: true,
    fallbackLanguage: "en",
  });

  const description = clean(display.description);
  const termsLine = clean(bare.lockedOfferContent?.termsLine);
  // Mirrors lib/localized-deal-display.ts's own endSentence() exactly (same regex, same
  // fallback period) so this reconstructs the join's expected OUTPUT rather than its
  // internal decision — deliberately not reaching into the unexported joinUniqueText.
  const endSentence = (text) => (/[.!?…]$/.test(text) ? text : `${text}.`);

  // The precise, unambiguous S13 contract: because supportingCopy was built to carry
  // every content word of primaryOfferLine, alreadySaid() must drop primaryOfferLine as
  // a distinct part, leaving exactly supportingCopy + termsLine joined — never all three.
  // This is checked by exact reconstruction rather than by scanning description for
  // primaryOfferLine's text, because for PERCENT_OFF_SINGLE_ITEM offers termsLine's own
  // template independently opens with the identical mechanic sentence (true even with no
  // AI copy involved at all — verified via the flagless `bare` call above) — a pre-existing
  // property of the offer-line template, not a joinUniqueText dedup failure, and scanning
  // for the bare text would misreport that template choice as an S13 regression.
  const expectedDeduped = termsLine ? `${endSentence(supportingCopy)} ${endSentence(termsLine)}` : null;
  if (expectedDeduped && description !== expectedDeduped) {
    errors.push(`offer_line_not_deduped:${description}`);
  }
  // Independent structural cross-check, using a different method (pattern heuristic
  // rather than string reconstruction) than the dedup contract above: two kept parts can
  // never run together without a sentence break the way "...of your choice Purchase any
  // large..." did pre-fix.
  if (/[a-z]\s+[A-Z][a-z]+ [a-z]/.test(description)) {
    errors.push(`sentences_run_together:${description}`);
  }
  // The terms line's distinct content (address/claim-limit, never a paraphrase of the
  // offer mechanic) must still survive the dedup — deleting the only statement of a term
  // is the failure mode S13 deliberately refused to risk.
  if (!description.includes(locationMarker)) {
    errors.push(`terms_content_dropped:${locationMarker}`);
  }
  return errors;
}

function validateRevisionFixture(fixture) {
  const errors = [];
  const actualTarget = copyOnlyRevisionTargetForFeedback(fixture.selectedTarget, fixture.feedback);
  if (actualTarget !== fixture.expectedTarget) {
    errors.push(`revision_target_mismatch:${actualTarget}`);
  }
  return errors;
}

const rows = fixtures.map((fixture) => {
  const oldText = oldHeadline(fixture);
  const newText = newHeadline(fixture);
  const errors = validate(fixture, newText);
  return {
    id: fixture.id,
    oldText,
    newText,
    valid: errors.length === 0,
    fallbackUsed: true,
    changedFacts: errors.filter((error) => error.startsWith("missing_")),
    characterCount: newText.length,
    errors,
  };
});

const failed = rows.filter((row) => !row.valid);
const posterRows = posterFixtures.map((fixture) => {
  const errors = validatePosterFixture(fixture);
  return {
    id: fixture.id,
    newText: fixture.expectedPosterHeadline,
    valid: errors.length === 0,
    fallbackUsed: true,
    characterCount: fixture.expectedPosterHeadline.length,
    errors,
  };
});
const failedPosterRows = posterRows.filter((row) => !row.valid);
const posterLocaleRows = posterFixtures.map((fixture) => {
  const errors = validatePosterLocaleFixture(fixture);
  return { id: fixture.id, valid: errors.length === 0, errors };
});
const failedPosterLocaleRows = posterLocaleRows.filter((row) => !row.valid);
const s13Rows = posterFixtures.map((fixture) => {
  const errors = S13_PROBE_LOCALES.flatMap((locale) =>
    validateS13RestatementGuardFixture(fixture, locale).map((error) => `${locale}:${error}`),
  );
  return { id: fixture.id, valid: errors.length === 0, errors };
});
const failedS13Rows = s13Rows.filter((row) => !row.valid);
const revisionRows = revisionFixtures.map((fixture) => {
  const errors = validateRevisionFixture(fixture);
  const target = copyOnlyRevisionTargetForFeedback(fixture.selectedTarget, fixture.feedback);
  return {
    id: fixture.id,
    newText: target,
    valid: errors.length === 0,
    fallbackUsed: false,
    characterCount: clean(fixture.feedback).length,
    errors,
  };
});
const failedRevisionRows = revisionRows.filter((row) => !row.valid);

console.log("# AI Promotional Copy Evaluation");
console.log(`fixtures: ${rows.length}`);
console.log(`valid: ${rows.length - failed.length}`);
console.log(`invalid: ${failed.length}`);
console.log(`poster fixtures: ${posterRows.length}`);
console.log(`poster valid: ${posterRows.length - failedPosterRows.length}`);
console.log(`poster invalid: ${failedPosterRows.length}`);
console.log(`poster locale fixtures (es-US + ko-KR each): ${posterLocaleRows.length}`);
console.log(`poster locale valid: ${posterLocaleRows.length - failedPosterLocaleRows.length}`);
console.log(`poster locale invalid: ${failedPosterLocaleRows.length}`);
console.log(`S13 restatement guard fixtures (en-US + es-US + ko-KR each): ${s13Rows.length}`);
console.log(`S13 restatement guard valid: ${s13Rows.length - failedS13Rows.length}`);
console.log(`S13 restatement guard invalid: ${failedS13Rows.length}`);
console.log(`revision fixtures: ${revisionRows.length}`);
console.log(`revision valid: ${revisionRows.length - failedRevisionRows.length}`);
console.log(`revision invalid: ${failedRevisionRows.length}`);
console.log("");
console.log("| id | old output | new output | valid | fallback | chars | changed facts |");
console.log("|---|---|---|---:|---:|---:|---|");
for (const row of rows) {
  console.log(
    `| ${row.id} | ${oldTextCell(row.oldText)} | ${oldTextCell(row.newText)} | ${row.valid ? "yes" : "no"} | ${row.fallbackUsed ? "yes" : "no"} | ${row.characterCount} | ${row.changedFacts.join(", ") || "none"} |`,
  );
}

if (failed.length > 0) {
  console.log("");
  console.log("Failures:");
  for (const row of failed) {
    console.log(`- ${row.id}: ${row.errors.join(", ")}`);
  }
  process.exitCode = 1;
}

if (failedPosterRows.length > 0) {
  console.log("");
  console.log("Poster failures:");
  for (const row of failedPosterRows) {
    console.log(`- ${row.id}: ${row.errors.join(", ")}`);
  }
  process.exitCode = 1;
}

if (failedPosterLocaleRows.length > 0) {
  console.log("");
  console.log("Poster locale failures:");
  for (const row of failedPosterLocaleRows) {
    console.log(`- ${row.id}: ${row.errors.join(", ")}`);
  }
  process.exitCode = 1;
}

if (failedS13Rows.length > 0) {
  console.log("");
  console.log("S13 restatement guard failures:");
  for (const row of failedS13Rows) {
    console.log(`- ${row.id}: ${row.errors.join(", ")}`);
  }
  process.exitCode = 1;
}

if (failedRevisionRows.length > 0) {
  console.log("");
  console.log("Revision feedback failures:");
  for (const row of failedRevisionRows) {
    console.log(`- ${row.id}: ${row.errors.join(", ")}`);
  }
  process.exitCode = 1;
}

function oldTextCell(value) {
  return clean(value).replace(/\|/g, "\\|");
}
