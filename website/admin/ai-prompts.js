(() => {
  const Shell = window.TwoferAdminShell;
  const statusEl = document.querySelector("[data-admin-status]");
  const promptStatusEl = document.querySelector("[data-prompt-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const promptBody = document.querySelector("[data-prompt-body]");
  const promptForm = document.querySelector("[data-prompt-form]");
  let prompts = [];
  let defaults = {};

  function syncNav() {
    const hasToken = Shell.hasStoredToken();
    if (loginLink) loginLink.hidden = hasToken;
    if (signOutButton) signOutButton.hidden = !hasToken;
  }

  function clearSession() {
    Shell.clearSession();
    syncNav();
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function setPromptStatus(message, tone = "info") {
    if (!promptStatusEl) return;
    promptStatusEl.textContent = message;
    promptStatusEl.className = `status${tone === "danger" ? " error" : ""}`;
  }

  async function adminPost(body) {
    return Shell.adminPost("admin-ai-prompts", body);
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function featureLabel(feature) {
    return String(feature || "")
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function defaultSystemPrompt(feature) {
    return [
      "You help run Twofer operations from the internal website/admin dashboard only.",
      "Never write instructions for the mobile app and never ask the browser or Expo client to call an AI provider.",
      "Do not create, suggest creating, or imply a live deal for an unclaimed prospect.",
      "Do not imply an unclaimed business is a Twofer partner.",
      "Demand proof must stay aggregated and must not reveal customer names, emails, phone numbers, exact home locations, or individual behavior.",
      "Keep Stripe, billing, claim-token, and trial actions recommendation-only unless a separate audited admin function performs the action.",
      "Do not include raw claim tokens, API keys, secrets, provider error bodies, or private source payloads.",
      "Use merchant-safe wording such as Twofer deals, local offers, limited-time offers, paired offers, or bonus item offers.",
      `Feature: ${feature}. Return only strict JSON matching the schema.`,
    ].join("\n");
  }

  function fillForm(prompt) {
    if (!promptForm) return;
    const feature = prompt?.feature || promptForm.elements.feature.value || "prospect_enrichment";
    promptForm.elements.feature.value = feature;
    promptForm.elements.prompt_name.value = prompt?.prompt_name || feature;
    promptForm.elements.prompt_version.value = prompt?.prompt_version || defaults[feature] || `admin-${feature}-v2`;
    promptForm.elements.system_prompt.value = prompt?.system_prompt || defaultSystemPrompt(feature);
    promptForm.elements.output_schema.value = JSON.stringify(prompt?.output_schema || {}, null, 2);
    promptForm.elements.is_active.checked = Boolean(prompt?.is_active);
  }

  function renderPrompts() {
    if (!promptBody) return;
    promptBody.innerHTML = "";
    if (!prompts.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "admin-row-detail";
      td.textContent = "No prompt versions found.";
      tr.appendChild(td);
      promptBody.appendChild(tr);
      return;
    }
    for (const prompt of prompts) {
      const tr = document.createElement("tr");
      const cells = [
        featureLabel(prompt.feature),
        prompt.prompt_version,
        prompt.is_active ? "Active" : "Inactive",
        formatDateTime(prompt.last_used_at),
      ];
      for (const [index, value] of cells.entries()) {
        const td = document.createElement("td");
        td.dataset.label = ["Feature", "Version", "Status", "Last used"][index];
        td.textContent = String(value || "");
        tr.appendChild(td);
      }
      const actionCell = document.createElement("td");
      actionCell.dataset.label = "Actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "button button-small button-secondary";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => fillForm(prompt));
      actionCell.appendChild(edit);
      if (!prompt.is_active) {
        const activate = document.createElement("button");
        activate.type = "button";
        activate.className = "button button-small";
        activate.textContent = "Activate";
        activate.addEventListener("click", () => activatePrompt(prompt.id));
        actionCell.appendChild(activate);
      }
      tr.appendChild(actionCell);
      promptBody.appendChild(tr);
    }
  }

  async function loadPrompts() {
    const payload = await adminPost({ action: "list" });
    prompts = payload.prompts || [];
    defaults = payload.defaults || {};
    renderPrompts();
    setStatus("Prompt registry loaded");
    if (promptForm && !promptForm.elements.system_prompt.value) fillForm(prompts[0]);
  }

  async function activatePrompt(promptId) {
    setPromptStatus("Activating prompt");
    await adminPost({ action: "activate", prompt_id: promptId });
    setPromptStatus("Prompt activated.");
    await loadPrompts();
  }

  async function savePrompt(event) {
    event.preventDefault();
    const formData = new FormData(promptForm);
    let outputSchema;
    try {
      outputSchema = JSON.parse(String(formData.get("output_schema") || "{}"));
    } catch {
      setPromptStatus("Output schema must be valid JSON.", "danger");
      return;
    }
    setPromptStatus("Saving prompt");
    await adminPost({
      action: "upsert",
      feature: String(formData.get("feature") || ""),
      prompt_name: String(formData.get("prompt_name") || ""),
      prompt_version: String(formData.get("prompt_version") || ""),
      system_prompt: String(formData.get("system_prompt") || ""),
      output_schema: outputSchema,
      is_active: Boolean(formData.get("is_active")),
    });
    setPromptStatus("Prompt saved.");
    await loadPrompts();
  }

  promptForm?.addEventListener("submit", (event) => {
    savePrompt(event).catch((error) => setPromptStatus(error instanceof Error ? error.message : "Could not save prompt.", "danger"));
  });

  document.querySelector("[data-refresh-prompts]")?.addEventListener("click", () => {
    loadPrompts().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load prompts.", "danger"));
  });

  document.querySelector("[data-new-prompt]")?.addEventListener("click", () => fillForm(null));
  document.querySelector("[data-reset-prompt-form]")?.addEventListener("click", () => fillForm(prompts[0]));
  promptForm?.elements.feature?.addEventListener("change", () => fillForm(null));

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  syncNav();
  loadPrompts().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load prompts.", "danger"));
})();
