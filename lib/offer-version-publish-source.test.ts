import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const fullCreateSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const quickCreateSource = readFileSync(join(process.cwd(), "app", "create", "quick.tsx"), "utf8");

describe("offer version publish source guards", () => {
  it("does not let full AI create silently direct-insert when versioned publish is enabled without an offer definition", () => {
    expect(fullCreateSource).toMatch(/!editingDealId && OFFER_VERSION_PUBLISH_ENABLED && !offerDefinition/);

    const publishBranch = fullCreateSource.indexOf("if (OFFER_VERSION_PUBLISH_ENABLED) {");
    const definitionGuard = fullCreateSource.indexOf("Missing offer definition for versioned publish.", publishBranch);
    const directInsert = fullCreateSource.indexOf("insertDealsWithCompatibility(rows)", publishBranch);

    expect(publishBranch).toBeGreaterThan(-1);
    expect(definitionGuard).toBeGreaterThan(publishBranch);
    expect(directInsert).toBeGreaterThan(definitionGuard);
  });

  it("does not let quick create silently direct-insert when versioned publish is enabled without an offer definition", () => {
    const publishBranch = quickCreateSource.indexOf("if (OFFER_VERSION_PUBLISH_ENABLED) {");
    const definitionGuard = quickCreateSource.indexOf("Missing offer definition for versioned publish.", publishBranch);
    const directInsert = quickCreateSource.indexOf("insertDealWithCompatibility(row)", publishBranch);

    expect(publishBranch).toBeGreaterThan(-1);
    expect(definitionGuard).toBeGreaterThan(publishBranch);
    expect(directInsert).toBeGreaterThan(definitionGuard);
  });
});

