export type BusinessSetupMode = "loading" | "create" | "edit";

export function getBusinessSetupCopyKeys(mode: BusinessSetupMode, busy: boolean) {
  const isEdit = mode === "edit";

  return {
    titleKey: isEdit ? "businessSetup.editTitle" : "businessSetup.title",
    subtitleKey: isEdit ? "businessSetup.editSubtitle" : "businessSetup.subtitle",
    legalHintKey: isEdit ? "legal.businessUpdateHint" : "legal.businessSetupHint",
    submitKey:
      mode === "loading"
        ? "businessSetup.loadingProfile"
        : busy
          ? isEdit
            ? "businessSetup.saving"
            : "businessSetup.creating"
          : isEdit
            ? "businessSetup.saveChanges"
            : "businessSetup.continue",
    successKey: isEdit ? "businessSetup.changesSaved" : "businessSetup.setupComplete",
    errorKey: isEdit ? "businessSetup.errSaveChanges" : "businessSetup.errSave",
  };
}
