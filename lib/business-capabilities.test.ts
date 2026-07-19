import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBusinessCapabilities } from "./business-capabilities";

describe("parseBusinessCapabilities", () => {
  it("fails closed for omitted or non-boolean capability values", () => {
    expect(
      parseBusinessCapabilities({
        reason_code: "approved_not_activated",
        can_use_setup_tools: true,
        can_generate_ai: "true",
        can_publish_offer: 1,
        setup_menu_extractions_remaining: 1.8,
      }),
    ).toMatchObject({
      reason_code: "approved_not_activated",
      can_use_setup_tools: true,
      can_generate_ai: false,
      can_publish_offer: false,
      can_receive_new_claims: false,
      setup_menu_extractions_remaining: 1,
    });
  });

  it("rejects invalid RPC payloads", () => {
    expect(parseBusinessCapabilities(null)).toBeNull();
    expect(parseBusinessCapabilities([])).toBeNull();
    expect(parseBusinessCapabilities("active")).toBeNull();
  });

  it("does not expose capabilities returned for a previous business", () => {
    const hook = readFileSync(
      join(process.cwd(), "hooks", "use-business-capabilities.ts"),
      "utf8",
    );
    expect(hook).toMatch(/requestSequence/);
    expect(hook).toMatch(/requestId !== requestSequence\.current/);
    expect(hook).toMatch(/state\.businessId === businessId/);
    expect(hook).toMatch(/!stateMatchesBusiness \|\| state\.loading/);
  });
});
