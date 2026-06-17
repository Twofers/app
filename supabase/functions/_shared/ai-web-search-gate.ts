export function shouldSkipWebSearchForMenuItem(itemHint: string): boolean {
  const normalized = itemHint.toLowerCase().replace(/[^a-z0-9+&\s-]/g, " ");
  const tokens = normalized.split(/[\s+&/-]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const commonFoodTokens = new Set([
    "bagel",
    "coffee",
    "latte",
    "muffin",
    "donut",
    "doughnut",
    "sandwich",
    "pizza",
    "taco",
    "pastry",
    "tea",
    "smoothie",
    "cookie",
    "burger",
    "fries",
    "salad",
    "croissant",
    "espresso",
    "cappuccino",
    "cortado",
    "matcha",
    "cold",
    "brew",
    "iced",
    "cake",
    "cupcake",
    "brownie",
    "burrito",
    "wrap",
    "soup",
    "bread",
    "toast",
    "lemonade",
    "juice",
    "boba",
    "chai",
    "americano",
    "mocha",
    "scone",
  ]);
  const connectorTokens = new Set(["and", "with", "plus", "free", "bogo", "buy", "one", "get", "a", "an", "the"]);
  return tokens.every((token) => commonFoodTokens.has(token) || connectorTokens.has(token));
}
