import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Source-contract tests for the in-app business application path (second front
// door beside the public website form). These pin the load-bearing wiring so a
// refactor can't silently: send an in-app applicant to the wrong email, drop
// the source tag, stop reporting application status, or bypass the Google
// lookup / consent capture.

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("submit-business-application: source tag + authed-email binding", () => {
  const src = read("supabase/functions/submit-business-application/index.ts");

  it("allowlists the source and never trusts an arbitrary source string", () => {
    expect(src).toMatch(/resolvedSource = payload\.source === "app_business_setup"/);
    // The insert + admin alert both use the resolved value, not a hardcoded one.
    expect(src).toMatch(/source: resolvedSource,/);
    expect(src).not.toMatch(/source: "website_start_trial",/);
  });

  it("binds authenticated submissions to the confirmed session email", () => {
    expect(src).toMatch(/async function resolveAuthedEmail/);
    // Only a confirmed user overrides the payload email.
    expect(src).toMatch(/email_confirmed_at/);
    expect(src).toMatch(/const authedEmail = await resolveAuthedEmail\(/);
    expect(src).toMatch(/const email = authedEmail \?\? cleanEmail\(payload\.email\)/);
  });
});

describe("get-business-onboarding-context: reports own application status", () => {
  const src = read("supabase/functions/get-business-onboarding-context/index.ts");

  it("reads and returns the applicant's own application state on the null branch", () => {
    expect(src).toMatch(/async function readApplicationStatus/);
    expect(src).toMatch(/const application = await readApplicationStatus\(supabaseAdmin, email\)/);
    expect(src).toMatch(/business: null,[\s\S]{0,60}application,/);
  });

  it("maps waitlisted / rejected / pending explicitly", () => {
    expect(src).toMatch(/status: "waitlisted"/);
    expect(src).toMatch(/status: "rejected"/);
    expect(src).toMatch(/status: "pending"/);
  });
});

describe("client contract (lib/business-application.ts)", () => {
  const src = read("lib/business-application.ts");

  it("exposes submitBusinessApplication tagged as the app source", () => {
    expect(src).toMatch(/export async function submitBusinessApplication/);
    expect(src).toMatch(/source: "app_business_setup"/);
  });

  it("types the onboarding application status via a narrow accessor", () => {
    expect(src).toMatch(/"none" \| "pending" \| "waitlisted" \| "rejected"/);
    expect(src).toMatch(/export function readOnboardingApplication/);
  });

  it("keeps the wrapper out of the hash-locked lib/functions.ts", () => {
    expect(read("lib/functions.ts")).not.toMatch(/submitBusinessApplication/);
  });
});

describe("in-app apply screen (app/business-apply.tsx)", () => {
  const src = read("app/business-apply.tsx");

  it("uses the verified Google Places lookup so applicants can self-fill", () => {
    expect(src).toMatch(/aiBusinessLookup\b/);
    expect(src).toMatch(/aiBusinessLookupDetails\b/);
    expect(src).toMatch(/isVerifiedBusinessLookupResult/);
  });

  it("submits via the app wrapper and captures explicit consent", () => {
    expect(src).toMatch(/submitBusinessApplication\(/);
    expect(src).toMatch(/terms_accepted: agreed/);
    expect(src).toMatch(/privacy_acknowledged: agreed/);
  });
});

describe("pending card is application-status aware (app/business-setup.tsx)", () => {
  const src = read("app/business-setup.tsx");

  it("drives copy off the returned application status", () => {
    expect(src).toMatch(/readOnboardingApplication\(onboardingContext\)/);
    expect(src).toMatch(/businessApply\.underReviewTitle/);
    expect(src).toMatch(/businessApply\.waitlistTitle/);
    expect(src).toMatch(/businessApply\.rejectedTitle/);
  });

  it("offers the in-app apply route when there is no application yet", () => {
    expect(src).toMatch(/businessApply\.applyNowCta/);
    expect(src).toMatch(/router\.push\("\/business-apply"/);
  });
});

describe("route registration (app/_layout.tsx)", () => {
  it("registers the business-apply stack screen", () => {
    expect(read("app/_layout.tsx")).toMatch(/name="business-apply"/);
  });
});
