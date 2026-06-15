import { describe, expect, it } from "vitest";

import { getBusinessSetupCopyKeys } from "./business-setup-copy";

describe("business setup copy", () => {
  it("uses creation copy for a new business", () => {
    expect(getBusinessSetupCopyKeys("create", false)).toMatchObject({
      titleKey: "businessSetup.title",
      subtitleKey: "businessSetup.subtitle",
      legalHintKey: "legal.businessSetupHint",
      submitKey: "businessSetup.continue",
      successKey: "businessSetup.setupComplete",
      errorKey: "businessSetup.errSave",
    });
  });

  it("uses save copy for an existing business profile", () => {
    expect(getBusinessSetupCopyKeys("edit", false)).toMatchObject({
      titleKey: "businessSetup.editTitle",
      subtitleKey: "businessSetup.editSubtitle",
      legalHintKey: "legal.businessUpdateHint",
      submitKey: "businessSetup.saveChanges",
      successKey: "businessSetup.changesSaved",
      errorKey: "businessSetup.errSaveChanges",
    });
  });

  it("keeps the CTA neutral while the existing-business check is loading", () => {
    expect(getBusinessSetupCopyKeys("loading", false).submitKey).toBe("businessSetup.loadingProfile");
  });

  it("uses mode-specific busy labels", () => {
    expect(getBusinessSetupCopyKeys("create", true).submitKey).toBe("businessSetup.creating");
    expect(getBusinessSetupCopyKeys("edit", true).submitKey).toBe("businessSetup.saving");
  });
});
