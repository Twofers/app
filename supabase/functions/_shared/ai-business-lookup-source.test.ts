import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-business-lookup", "index.ts"),
  "utf8",
);

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
