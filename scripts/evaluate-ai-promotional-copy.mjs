import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "fixtures", "ai-promotional-copy-offers.json");
const posterFixturePath = path.join(root, "fixtures", "ai-poster-copy-offers.json");
const revisionFixturePath = path.join(root, "fixtures", "ai-revision-feedback-cases.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const posterFixtures = JSON.parse(fs.readFileSync(posterFixturePath, "utf8"));
const revisionFixtures = JSON.parse(fs.readFileSync(revisionFixturePath, "utf8"));

const numberWords = new Map([
  [1, "one"],
  [2, "two"],
  [3, "three"],
  [4, "four"],
  [5, "five"],
  [6, "six"],
  [7, "seven"],
  [8, "eight"],
  [9, "nine"],
  [10, "ten"],
]);

function clean(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function lowerFirst(value) {
  const text = clean(value);
  return /^[A-Z]{2,}\b/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

function stripArticle(value) {
  return clean(value).replace(/^(?:a|an|the)\s+/i, "");
}

function articleFor(value) {
  const text = stripArticle(value);
  if (/^(?:honest|hour|heir|herb)\b/i.test(text)) return "an";
  if (/^(?:uni([^nmd]|$)|user|useful|utensil|u[bcfhjkqrst][a-z])/i.test(text)) return "a";
  return /^[aeiou]/i.test(text) ? "an" : "a";
}

function pluralizeWord(word) {
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/fe$/i.test(word)) return `${word.slice(0, -2)}ves`;
  if (/f$/i.test(word)) return `${word.slice(0, -1)}ves`;
  return `${word}s`;
}

function pluralizePhrase(value) {
  const text = stripArticle(value);
  const match = text.match(/([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
  if (!match) return text;
  const [full, word, suffix] = match;
  if (/s$/i.test(word) && !/(?:ss|us)$/i.test(word)) return text;
  return `${text.slice(0, text.length - full.length)}${pluralizeWord(word)}${suffix}`;
}

function looksPluralLike(value) {
  const lastWord = stripArticle(value).toLowerCase().match(/[a-z][a-z'-]*$/)?.[0] ?? "";
  return Boolean(lastWord && /s$/.test(lastWord) && !/(?:ss|us)$/.test(lastWord));
}

function quantityWord(quantity) {
  return numberWords.get(quantity) ?? String(quantity);
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

function purchasePhrase(quantity, item) {
  if (quantity === 1) return `${articleFor(item)} ${lowerFirst(stripArticle(item))}`;
  return `${quantityWord(quantity)} ${pluralizePhrase(item)}`;
}

function countedPhrase(quantity, item) {
  if (quantity === 1) return `one ${lowerFirst(stripArticle(item))}`;
  return `${quantityWord(quantity)} ${pluralizePhrase(item)}`;
}

function rewardPhrase(quantity, item) {
  if (quantity === 1 && looksPluralLike(item)) return `free ${lowerFirst(stripArticle(item))}`;
  if (quantity === 1) return `a free ${lowerFirst(stripArticle(item))}`;
  return `${quantityWord(quantity)} free ${pluralizePhrase(item)}`;
}

function newHeadline(fixture) {
  if (fixture.rewardType === "percent_off") {
    return `Get ${Math.round(Number(fixture.rewardValue))}% off one ${lowerFirst(stripArticle(fixture.buyItem))}`;
  }
  if (sameItem(fixture.buyItem, fixture.rewardItem)) {
    const reward = fixture.rewardQuantity === 1 ? "one free" : `${quantityWord(fixture.rewardQuantity)} free`;
    return `Buy ${countedPhrase(fixture.buyQuantity, fixture.buyItem)} and get ${reward}`;
  }
  return `Buy ${purchasePhrase(fixture.buyQuantity, fixture.buyItem)} and get ${rewardPhrase(fixture.rewardQuantity, fixture.rewardItem)}`;
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

const posterStopWords = new Set([
  "a",
  "an",
  "any",
  "the",
  "one",
  "of",
  "your",
  "choice",
  "large",
  "medium",
  "small",
  "regular",
  "hot",
  "iced",
  "ice",
  "cold",
  "fresh",
]);

const posterKnownItemWords = [
  "coffee",
  "latte",
  "espresso",
  "cappuccino",
  "cookie",
  "bagel",
  "sandwich",
  "muffin",
  "croissant",
  "pastry",
  "scone",
  "tea",
  "drink",
  "taco",
  "dessert",
  "entree",
];

function normalizePoster(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s+%-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function posterItemLabel(value) {
  const normalized = normalizePoster(value);
  if (!normalized) return "";
  const words = normalized.split(/\s+/).filter(Boolean);
  const known = posterKnownItemWords.find((word) => words.includes(word));
  if (known && !(known === "drink" && words.includes("coffee"))) return known;
  if (words.includes("coffee")) return "coffee";
  const meaningful = words.filter((word) => !posterStopWords.has(word));
  if (meaningful.length === 0) return words.slice(0, 2).join(" ");
  return meaningful.slice(-2).join(" ");
}

function posterHeadlineFallback(fixture) {
  const firstItem = posterItemLabel(fixture.buyItem);
  const rewardItem = posterItemLabel(fixture.rewardItem);
  if (fixture.rewardType === "percent_off") return firstItem ? `${firstItem} savings` : "local deal";
  if (sameItem(fixture.buyItem, fixture.rewardItem)) return firstItem ? `${firstItem} bonus` : "local bonus";
  if (firstItem && rewardItem) {
    const pair = `${firstItem} + ${rewardItem}`;
    return pair.length <= 22 ? `${pair} break` : pair;
  }
  return firstItem || rewardItem || "local deal";
}

function posterLineItem(value, maxChars = 28) {
  const text = clean(value);
  const clamped = text.length <= maxChars
    ? text
    : text.split(/\s+/).reduce((out, word) => {
      const next = out ? `${out} ${word}` : word;
      return next.length <= maxChars ? next : out;
    }, "") || text;
  return clamped.toUpperCase();
}

function buildPosterOfferLines(fixture) {
  const firstQty = Number(fixture.buyQuantity) > 1 ? Math.floor(Number(fixture.buyQuantity)) : 1;
  if (fixture.rewardType === "percent_off") {
    return {
      offerLine1: `${Math.round(Number(fixture.rewardValue))}% OFF`,
      offerLine2: posterLineItem(fixture.buyItem, 24),
    };
  }
  return {
    offerLine1: posterLineItem(`BUY ${firstQty} ${fixture.buyItem || "ITEM"}`, 28),
    offerLine2: sameItem(fixture.buyItem, fixture.rewardItem)
      ? posterLineItem(`GET ${Number(fixture.rewardQuantity) > 1 ? Math.floor(Number(fixture.rewardQuantity)) : 1} FREE`, 22)
      : posterLineItem(`GET ${Number(fixture.rewardQuantity) > 1 ? Math.floor(Number(fixture.rewardQuantity)) : 1} ${fixture.rewardItem || "FREE"}`, 28),
  };
}

function isMechanicalPosterHeadline(value) {
  const text = clean(value).toLowerCase();
  if (!text) return false;
  if (/\bbuy\b/.test(text) && /\bget\b/.test(text)) return true;
  if (/\b\d+\s*%\s*off\b/.test(text)) return true;
  if (/\bfree\b/.test(text) && /\bwith\b|\bbuy\b|\bpurchase\b/.test(text)) return true;
  return false;
}

function isWeakPosterHero(value) {
  return /^try\s+(?:our|the)\b/.test(normalizePoster(value));
}

function isBarePosterItemHeadline(value, fixture) {
  const headline = normalizePoster(value);
  if (!headline) return false;
  const itemNames = [fixture.buyItem, fixture.rewardItem].map(normalizePoster).filter(Boolean);
  if (itemNames.some((item) => headline === item)) return true;
  const itemLabels = itemNames.map(posterItemLabel).filter(Boolean);
  if (itemLabels.some((label) => headline === normalizePoster(label))) return true;
  const words = headline.split(/\s+/).filter((word) => !posterStopWords.has(word));
  const normalizedWords = words.join(" ");
  return itemLabels.some((label) => {
    const normalizedLabel = normalizePoster(label);
    return normalizedWords === normalizedLabel || (words.length <= 3 && words.includes(normalizedLabel));
  });
}

function buildPosterHeadline(fixture, requestedHeadline) {
  const fallback = posterHeadlineFallback(fixture);
  const requested = clean(requestedHeadline);
  if (!requested) return fallback.toUpperCase();
  if (isWeakPosterHero(requested)) return fallback.toUpperCase();
  if (isMechanicalPosterHeadline(requested)) return fallback.toUpperCase();
  if (isBarePosterItemHeadline(requested, fixture)) return fallback.toUpperCase();
  return requested.toUpperCase();
}

function validatePosterFixture(fixture) {
  const errors = [];
  const lines = buildPosterOfferLines(fixture);
  if (lines.offerLine1 !== fixture.expectedOfferLine1) errors.push("offer_line_1_changed");
  if (lines.offerLine2 !== fixture.expectedOfferLine2) errors.push("offer_line_2_changed");
  for (const rejected of fixture.rejectedHeadlines ?? []) {
    const headline = buildPosterHeadline(fixture, rejected);
    if (headline !== fixture.expectedPosterHeadline) {
      errors.push(`accepted_weak_headline:${rejected}`);
    }
  }
  return errors;
}

function routeRevisionTarget(selectedTarget, feedback) {
  if (selectedTarget !== "both") return selectedTarget;
  const normalized = clean(feedback).toLowerCase();
  if (!normalized) return selectedTarget;
  const mentionsImage = /\b(?:image|photo|picture|pic|background|crop|lighting|angle|composition|visual|brighter|darker)\b/.test(normalized);
  const mentionsCopy = /\b(?:copy|wording|words?|text|headline|title|top|line|shorter|clearer|tone|warmer|premium|direct)\b/.test(normalized);
  return mentionsCopy && !mentionsImage ? "copy" : selectedTarget;
}

function validateRevisionFixture(fixture) {
  const errors = [];
  const actualTarget = routeRevisionTarget(fixture.selectedTarget, fixture.feedback);
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
const revisionRows = revisionFixtures.map((fixture) => {
  const errors = validateRevisionFixture(fixture);
  return {
    id: fixture.id,
    newText: routeRevisionTarget(fixture.selectedTarget, fixture.feedback),
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
