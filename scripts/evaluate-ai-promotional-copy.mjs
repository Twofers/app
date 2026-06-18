import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturePath = path.join(root, "fixtures", "ai-promotional-copy-offers.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

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
console.log("# AI Promotional Copy Evaluation");
console.log(`fixtures: ${rows.length}`);
console.log(`valid: ${rows.length - failed.length}`);
console.log(`invalid: ${failed.length}`);
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

function oldTextCell(value) {
  return clean(value).replace(/\|/g, "\\|");
}
