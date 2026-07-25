import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const businessApplySource = readFileSync(join(process.cwd(), "app", "business-apply.tsx"), "utf8");

describe("business application submit guard", () => {
  it("keeps the submit button disabled through the post-success redirect", () => {
    // F-08: onSubmit used an unconditional `finally { setBusy(false) }` while the
    // success path schedules a 1s delayed navigation. That re-enabled the button
    // for the whole window, so a second tap filed a duplicate application — or
    // tripped the 429 ceiling and replaced the success banner with an error on a
    // submission that had actually succeeded.
    expect(businessApplySource).toContain("let submitted = false;");
    expect(businessApplySource).toContain("submitted = true;");
    expect(businessApplySource).toContain("if (!submitted) setBusy(false);");
    expect(businessApplySource).not.toMatch(/finally \{\s+setBusy\(false\);\s+\}/);
  });

  it("still guards re-entry and disables the button while in flight", () => {
    expect(businessApplySource).toContain("if (busy) return;");
    expect(businessApplySource).toContain("disabled={busy}");
  });

  it("routes submit failures through the localized translator", () => {
    expect(businessApplySource).toContain("translateKnownApiMessage(raw, t)");
  });
});
