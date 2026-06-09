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

export type BusinessProfileSaveValidation =
  | { ok: true; values: NormalizedBusinessProfileSaveDraft }
  | { ok: false; reason: "nameAddress" | "email"; values: NormalizedBusinessProfileSaveDraft };

const BUSINESS_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (values.businessEmail && !BUSINESS_EMAIL_PATTERN.test(values.businessEmail)) {
    return { ok: false, reason: "email", values };
  }

  return { ok: true, values };
}
