export type BusinessProfileSaveDraft = {
  name: string;
  contactName: string;
  businessEmail: string;
  phone: string;
  address: string;
  category: string;
  hours: string;
};

export type NormalizedBusinessProfileSaveDraft = {
  name: string;
  contactName: string;
  businessEmail: string;
  phone: string;
  address: string;
  category: string;
  hours: string;
};

export type BusinessProfileEditorDraft = BusinessProfileSaveDraft & {
  tone: string;
  location: string;
  latitude: string;
  longitude: string;
  shortDescription: string;
  preferredLocale: string | null;
};

export type NormalizedBusinessProfileEditorDraft = NormalizedBusinessProfileSaveDraft & {
  tone: string;
  location: string;
  latitude: string;
  longitude: string;
  shortDescription: string;
  preferredLocale: string | null;
};

export type BusinessProfileSaveValidation =
  | { ok: true; values: NormalizedBusinessProfileSaveDraft }
  | { ok: false; reason: "nameAddress" | "email"; values: NormalizedBusinessProfileSaveDraft };

const BUSINESS_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidBusinessEmail(value: string): boolean {
  const trimmed = value.trim();
  return !trimmed || BUSINESS_EMAIL_PATTERN.test(trimmed);
}

export function normalizeBusinessProfileSaveDraft(
  draft: BusinessProfileSaveDraft,
): NormalizedBusinessProfileSaveDraft {
  return {
    name: draft.name.trim(),
    contactName: draft.contactName.trim(),
    businessEmail: draft.businessEmail.trim(),
    phone: draft.phone.trim(),
    address: draft.address.trim(),
    category: draft.category.trim(),
    hours: draft.hours.trim(),
  };
}

export function validateBusinessProfileSaveDraft(
  draft: BusinessProfileSaveDraft,
): BusinessProfileSaveValidation {
  const values = normalizeBusinessProfileSaveDraft(draft);

  if (!values.name || !values.address) {
    return { ok: false, reason: "nameAddress", values };
  }

  if (!isValidBusinessEmail(values.businessEmail)) {
    return { ok: false, reason: "email", values };
  }

  return { ok: true, values };
}

export function normalizeBusinessProfileEditorDraft(
  draft: BusinessProfileEditorDraft,
): NormalizedBusinessProfileEditorDraft {
  return {
    ...normalizeBusinessProfileSaveDraft(draft),
    tone: draft.tone.trim(),
    location: draft.location.trim(),
    latitude: draft.latitude.trim(),
    longitude: draft.longitude.trim(),
    shortDescription: draft.shortDescription.trim(),
    preferredLocale: draft.preferredLocale,
  };
}

export function isBusinessProfileEditorDirty(
  current: BusinessProfileEditorDraft,
  saved: BusinessProfileEditorDraft,
): boolean {
  const currentValues = normalizeBusinessProfileEditorDraft(current);
  const savedValues = normalizeBusinessProfileEditorDraft(saved);
  return (Object.keys(currentValues) as Array<keyof NormalizedBusinessProfileEditorDraft>).some(
    (key) => currentValues[key] !== savedValues[key],
  );
}
