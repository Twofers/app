import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-business-lookup", "index.ts"),
  "utf8",
);

/**
 * index.ts cannot be imported directly: its module scope calls `serve(...)`
 * against a remote `https://deno.land/...` specifier that vitest/Node cannot
 * resolve. To test mapCategory's actual runtime behavior (not just pin its
 * source text), extract the pure TYPE_MAP / SPECIFIC_TYPE_MAP / mapCategory
 * slice, strip TypeScript via esbuild (already a transitive devDependency
 * through vite/vitest), and evaluate it in an isolated vm context.
 */
function loadMapCategory(): (types: unknown) => string {
  const start = source.indexOf("const TYPE_MAP");
  const end = source.indexOf("function normalizeGooglePlace");
  if (start === -1 || end === -1) {
    throw new Error("Could not locate the TYPE_MAP..mapCategory source slice");
  }
  const tsSlice = source.slice(start, end);
  const { code } = transformSync(tsSlice, { loader: "ts" });
  const sandbox: { exports: Record<string, unknown> } = { exports: {} };
  vm.createContext(sandbox);
  vm.runInContext(`${code}\nexports.mapCategory = mapCategory;`, sandbox);
  const mapCategory = sandbox.exports.mapCategory;
  if (typeof mapCategory !== "function") {
    throw new Error("mapCategory did not evaluate to a function");
  }
  return mapCategory as (types: unknown) => string;
}

describe("ai-business-lookup source guards", () => {
  it("does not log raw Google lookup or outer handler exception text", () => {
    expect(source).toMatch(/GOOGLE_PLACES_SEARCH_EXCEPTION/);
    expect(source).toMatch(/GOOGLE_PLACE_DETAILS_EXCEPTION/);
    expect(source).toMatch(/BUSINESS_LOOKUP_SERVER_ERROR/);
    expect(source).not.toMatch(/err:\s*String\(err\)/);
    expect(source).not.toMatch(/logLookup\("server_error",\s*\{\s*err:/);
  });

  it("lets a pre-approval applicant look up (no business yet), owners keep the capability gate", () => {
    // Owner path unchanged: exactly one owned business + setup capability.
    expect(source).toMatch(/ownedBusinesses\.length === 1/);
    expect(source).toMatch(/can_use_setup_tools/);
    // Applicant path: no business row yet is allowed after an email-confirmed check,
    // so the in-app application flow can self-fill before approval.
    expect(source).toMatch(/ownedBusinesses\.length === 0/);
    expect(source).toMatch(/email_confirmed_at/);
    expect(source).toMatch(/BUSINESS_LOOKUP_EMAIL_UNCONFIRMED/);
    // The old unconditional "must own exactly one" hard block is gone.
    expect(source).not.toMatch(/ownedBusinesses\.length !== 1/);
  });

  it("rate-limits the applicant lookup path so owners stay unlimited", () => {
    expect(source).toMatch(/APPLICANT_LOOKUP_LIMIT/);
    expect(source).toMatch(/BUSINESS_LOOKUP_RATE_LIMITED/);
    expect(source).toMatch(/429/);
    // Counted per account in the trailing window via system_events.
    expect(source).toMatch(/system_events/);
    expect(source).toMatch(/metadata->>actor_user_id/);
  });
});

describe("mapCategory (specific-over-generic Google Places category mapping)", () => {
  const mapCategory = loadMapCategory();

  it("prefers a specific match over a generic one present in the same types array", () => {
    expect(mapCategory(["mexican_restaurant", "restaurant", "food", "point_of_interest"])).toBe(
      "Mexican restaurant",
    );
  });

  it("finds the specific match regardless of its position in the types array", () => {
    expect(mapCategory(["point_of_interest", "establishment", "korean_restaurant"])).toBe(
      "Korean restaurant",
    );
  });

  it("maps a representative spread of newly-added specific types to real Places API (New) type ids", () => {
    expect(mapCategory(["pizza_restaurant"])).toBe("Pizza restaurant");
    expect(mapCategory(["juice_shop"])).toBe("Juice shop");
    expect(mapCategory(["barber_shop"])).toBe("Barber shop");
    expect(mapCategory(["hair_salon"])).toBe("Hair salon");
    expect(mapCategory(["nail_salon"])).toBe("Nail salon");
    expect(mapCategory(["gym"])).toBe("Gym");
    expect(mapCategory(["car_wash"])).toBe("Car wash");
    expect(mapCategory(["car_repair"])).toBe("Car repair");
    expect(mapCategory(["ice_cream_shop"])).toBe("Ice cream shop");
    expect(mapCategory(["sandwich_shop"])).toBe("Sandwich shop");
    expect(mapCategory(["seafood_restaurant"])).toBe("Seafood restaurant");
    expect(mapCategory(["steak_house"])).toBe("Steakhouse");
    expect(mapCategory(["sushi_restaurant"])).toBe("Sushi restaurant");
    expect(mapCategory(["taco_restaurant"])).toBe("Taco restaurant");
    expect(mapCategory(["tea_house"])).toBe("Tea house");
    expect(mapCategory(["vegan_restaurant"])).toBe("Vegan restaurant");
    expect(mapCategory(["vegetarian_restaurant"])).toBe("Vegetarian restaurant");
    expect(mapCategory(["dessert_shop"])).toBe("Dessert shop");
    expect(mapCategory(["donut_shop"])).toBe("Donut shop");
    expect(mapCategory(["breakfast_restaurant"])).toBe("Breakfast restaurant");
    expect(mapCategory(["brunch_restaurant"])).toBe("Brunch restaurant");
  });

  it("falls back to the generic TYPE_MAP when no specific type is present (current behavior preserved)", () => {
    expect(mapCategory(["restaurant"])).toBe("Restaurant");
    expect(mapCategory(["cafe"])).toBe("Cafe");
    expect(mapCategory(["bakery"])).toBe("Bakery");
    expect(mapCategory(["bar"])).toBe("Bar");
  });

  it("falls back to 'Local business' for unknown types or a non-array input (current behavior preserved)", () => {
    expect(mapCategory(["point_of_interest", "establishment"])).toBe("Local business");
    expect(mapCategory([])).toBe("Local business");
    expect(mapCategory(undefined)).toBe("Local business");
    expect(mapCategory(null)).toBe("Local business");
    expect(mapCategory("restaurant")).toBe("Local business");
  });

  it("ignores non-string entries in the types array", () => {
    expect(mapCategory([42, null, "mexican_restaurant"])).toBe("Mexican restaurant");
  });
});
