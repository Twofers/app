import { describe, expect, it } from "vitest";

import {
  isBusinessProfileEditorDirty,
  isValidBusinessEmail,
  normalizeBusinessProfileSaveDraft,
  validateBusinessProfileSaveDraft,
  type BusinessProfileEditorDraft,
} from "./business-profile-save";

const completeDraft = {
  name: "Demo Cafe",
  contactName: "Alex Kim",
  businessEmail: "hello@example.com",
  phone: "(512) 555-0100",
  address: "123 Main St",
  category: "Cafe",
  hours: "Mon-Fri 7a-4p",
};

const completeEditorDraft: BusinessProfileEditorDraft = {
  ...completeDraft,
  tone: "Friendly",
  location: "Downtown",
  latitude: "30.2672",
  longitude: "-97.7431",
  shortDescription: "A local cafe.",
  preferredLocale: "en",
};

describe("business profile save validation", () => {
  it("allows profile detail fields to be saved later", () => {
    expect(
      validateBusinessProfileSaveDraft({
        ...completeDraft,
        contactName: "",
        businessEmail: "",
        phone: "",
        category: "",
        hours: "",
      }),
    ).toEqual({
      ok: true,
      values: {
        name: "Demo Cafe",
        contactName: "",
        businessEmail: "",
        phone: "",
        address: "123 Main St",
        category: "",
        hours: "",
      },
    });
  });

  it("still requires the business name and address", () => {
    expect(validateBusinessProfileSaveDraft({ ...completeDraft, name: " " })).toMatchObject({
      ok: false,
      reason: "nameAddress",
    });
    expect(validateBusinessProfileSaveDraft({ ...completeDraft, address: " " })).toMatchObject({
      ok: false,
      reason: "nameAddress",
    });
  });

  it("validates business email only when one is entered", () => {
    expect(isValidBusinessEmail(" hello@example.com ")).toBe(true);
    expect(isValidBusinessEmail("")).toBe(true);
    expect(isValidBusinessEmail("not-email")).toBe(false);

    expect(validateBusinessProfileSaveDraft({ ...completeDraft, businessEmail: "" })).toMatchObject({
      ok: true,
    });
    expect(validateBusinessProfileSaveDraft({ ...completeDraft, businessEmail: "not-email" })).toMatchObject({
      ok: false,
      reason: "email",
    });
  });

  it("trims values before saving", () => {
    expect(
      normalizeBusinessProfileSaveDraft({
        name: " Demo Cafe ",
        contactName: " Alex ",
        businessEmail: " hello@example.com ",
        phone: " 555 ",
        address: " 123 Main ",
        category: " Cafe ",
        hours: " Daily ",
      }),
    ).toEqual({
      name: "Demo Cafe",
      contactName: "Alex",
      businessEmail: "hello@example.com",
      phone: "555",
      address: "123 Main",
      category: "Cafe",
      hours: "Daily",
    });
  });

  it("does not treat whitespace-only editor changes as dirty", () => {
    expect(
      isBusinessProfileEditorDirty(
        {
          ...completeEditorDraft,
          name: " Demo Cafe ",
          shortDescription: " A local cafe. ",
        },
        completeEditorDraft,
      ),
    ).toBe(false);
  });

  it("detects dirty editor changes across profile fields", () => {
    expect(
      isBusinessProfileEditorDirty(
        {
          ...completeEditorDraft,
          name: "New Cafe",
        },
        completeEditorDraft,
      ),
    ).toBe(true);

    expect(
      isBusinessProfileEditorDirty(
        {
          ...completeEditorDraft,
          preferredLocale: "es",
        },
        completeEditorDraft,
      ),
    ).toBe(true);
  });
});
