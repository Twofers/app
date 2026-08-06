// Business-access application form (/business/start-trial).
//
// Page-local, not shared: this file exists as a separate script only so the
// public Content-Security-Policy can enforce `script-src 'self'` with no
// inline-script allowance. It is loaded end-of-body, after localization.js,
// so window.TwoferI18n is already defined when msg() runs.
const form = document.querySelector("#business-application");
const statusEl = document.querySelector("#form-status");
const submitButton = form.querySelector("[data-submit-button]");
const applicationHeading = document.querySelector("#business-application-heading");

document.querySelector(".trial-jump")?.addEventListener("click", () => {
  window.setTimeout(() => applicationHeading?.focus(), 0);
});

function msg(key) {
  return window.TwoferI18n?.t(key) || "";
}

function setStatus(text, isError = false) {
  statusEl.className = isError ? "status error" : "status";
  statusEl.setAttribute("role", isError ? "alert" : "status");
  statusEl.textContent = text;
}

function clearInvalid() {
  for (const field of form.querySelectorAll(".invalid")) {
    field.classList.remove("invalid");
    field.removeAttribute("aria-invalid");
  }
}

function markInvalid(name) {
  const field = form.querySelector(`[name="${name}"]`);
  if (!field) return;
  field.classList.add("invalid");
  field.setAttribute("aria-invalid", "true");
  return field;
}

function validationMessage(data) {
  if (!String(data.get("business_name") || "").trim()) return { field: markInvalid("business_name"), text: msg("trial.validationName") || "Enter your business name." };
  if (!String(data.get("contact_name") || "").trim()) return { field: markInvalid("contact_name"), text: msg("trial.validationContact") || "Enter the owner or manager name." };
  const email = String(data.get("email") || "").trim();
  if (!email || !email.includes("@")) return { field: markInvalid("email"), text: msg("trial.validationEmail") || "Enter a valid business email." };
  // Address is optional, and stays optional: it lives in the collapsed
  // "Add business details" block, so requiring it blocked submission on a field
  // the form calls optional and does not even show. The server treats a missing
  // address as an unknown launch area (human review), never an auto-waitlist.
  if (data.get("terms_accepted") !== "on") return { field: markInvalid("terms_accepted"), text: msg("trial.validationTerms") || "Please accept the Business Terms." };
  if (data.get("privacy_acknowledged") !== "on") return { field: markInvalid("privacy_acknowledged"), text: msg("trial.validationPrivacy") || "Please acknowledge the Privacy Policy." };
  return null;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearInvalid();
  const data = new FormData(form);
  const invalid = validationMessage(data);
  if (invalid) {
    setStatus(invalid.text, true);
    // A field inside a collapsed section can be neither seen nor focused, which
    // reads as "the form refuses to submit and will not say where". Open its
    // section first so the error always points at something visible.
    invalid.field?.closest("details")?.setAttribute("open", "");
    invalid.field?.focus();
    return;
  }
  setStatus(msg("trial.submitting") || "Submitting...");
  submitButton.disabled = true;
  const payload = Object.fromEntries(data.entries());
  payload.terms_accepted = data.get("terms_accepted") === "on";
  payload.privacy_acknowledged = data.get("privacy_acknowledged") === "on";
  // Optional: an unchecked box is absent from FormData, so this is false
  // unless the business explicitly opted in.
  payload.promo_materials_authorized = data.get("promo_materials_authorized") === "on";
  try {
    const response = await fetch(document.body.dataset.applicationEndpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (response.status === 429) {
      setStatus(msg("trial.rateLimited") || "You have reached the request limit for now. Please try again in about 30 minutes.", true);
      return;
    }
    if (!response.ok) throw new Error("Request failed");
    window.location.assign("/business/thanks/");
  } catch {
    setStatus(msg("trial.failure") || "We could not submit the request. Please try again, or email support@twoferapp.com.", true);
  } finally {
    submitButton.disabled = false;
  }
});
