(() => {
  const endpoint = document.body.dataset.claimEndpoint;
  const form = document.querySelector("[data-claim-form]");
  const statusEl = document.querySelector("#claim-status");
  const nameEl = document.querySelector("[data-claim-business-name]");
  const metaEl = document.querySelector("[data-claim-business-meta]");
  const stateEl = document.querySelector("[data-claim-public-state]");
  const statementEl = document.querySelector("[data-claim-statement]");

  function tokenFromPath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const index = segments.indexOf("claim");
    return index >= 0 ? segments[index + 1] || "" : "";
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status${tone === "danger" ? " error" : ""}`;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function renderPreview(preview) {
    if (!preview) return;
    if (nameEl) nameEl.textContent = preview.business_name || "Business profile";
    if (metaEl) metaEl.textContent = [preview.city, preview.state, preview.category].filter(Boolean).join(" | ");
    if (stateEl) stateEl.textContent = preview.public_label_state || "Not on Twofer yet";
    if (statementEl) statementEl.textContent = preview.statement || "This profile is not active on Twofer until you claim and complete setup.";
  }

  async function loadPreview() {
    const token = tokenFromPath();
    if (!token) {
      setStatus("This claim link is missing a token.", "danger");
      return;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", token }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || "This claim link is not available.");
    renderPreview(payload.preview);
    setStatus("");
  }

  async function submitClaim(event) {
    event.preventDefault();
    const token = tokenFromPath();
    const data = new FormData(form);
    if (data.get("authority_confirmed") !== "on") {
      setStatus("Confirm you are authorized to start this claim.", "danger");
      return;
    }
    setStatus("Starting claim...");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start_claim",
        token,
        contact_name: data.get("contact_name"),
        owner_email: data.get("owner_email"),
        phone: data.get("phone"),
      }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not start this claim.");
    renderPreview(payload.preview);
    setStatus(payload.next_step || "Claim started. Finish setup before the profile can become active.");
    form.reset();
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      submitClaim(event).catch((error) => setStatus(error instanceof Error ? error.message : "Could not start this claim.", "danger"));
    });
  }

  loadPreview().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load this claim link.", "danger"));
})();
