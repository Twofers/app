(() => {
  const endpoint = document.body.dataset.quickApprovalEndpoint;
  const statusEl = document.querySelector("[data-quick-approval-status]");
  const detailsEl = document.querySelector("[data-quick-approval-details]");
  const limitsEl = document.querySelector("[data-quick-approval-limits]");
  const actionsEl = document.querySelector("[data-quick-approval-actions]");
  const resultEl = document.querySelector("[data-quick-approval-result]");
  const confirmButton = document.querySelector("[data-confirm-quick-approval]");
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") || "";

  // Remove the bearer token from the address bar before any network request.
  // It remains only in this page's memory for the explicit confirmation POST.
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

  function t(key, fallback) {
    return window.TwoferI18n?.t(key) || fallback;
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status${tone === "danger" ? " error" : tone === "warning" ? " warning" : ""}`;
  }

  function setText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = String(value ?? "—");
  }

  async function post(action) {
    if (!endpoint) throw new Error(t("quickApproval.notConfigured", "Quick approval is not configured."));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, token }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        const message = response.status === 410
          ? t("quickApproval.unavailable", "This quick-approval link is invalid, expired, already used, or no longer eligible.")
          : response.status === 409
          ? t("quickApproval.processing", "This approval is already being processed. Please wait a moment.")
          : t("quickApproval.failure", "This approval could not be completed.");
        throw new Error(message);
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(t("quickApproval.timeout", "The approval request timed out. Please try again."));
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadPreview() {
    if (!token) throw new Error(t("quickApproval.missing", "This quick-approval link is missing or invalid."));
    const payload = await post("quick_preview");
    const application = payload.application || {};
    setText("[data-business-name]", application.business_name);
    setText("[data-contact-name]", application.contact_name);
    setText("[data-owner-email]", application.email);
    setText("[data-business-address]", application.address);
    setText("[data-business-type]", application.business_type);
    setText("[data-risk-score]", application.risk_score);
    if (detailsEl) detailsEl.hidden = false;
    if (limitsEl) limitsEl.hidden = false;
    if (actionsEl) actionsEl.hidden = false;
    setStatus(t("quickApproval.ready", "Ready for your decision."));
  }

  if (confirmButton) {
    confirmButton.addEventListener("click", async () => {
      confirmButton.disabled = true;
      setStatus(t("quickApproval.approving", "Approving setup access..."));
      try {
        const payload = await post("quick_confirm");
        if (detailsEl) detailsEl.hidden = true;
        if (limitsEl) limitsEl.hidden = true;
        if (actionsEl) actionsEl.hidden = true;
        if (resultEl) resultEl.hidden = false;
        setStatus(
          payload.approval_email_warning
            ? `${t("quickApproval.approvedWarning", "Setup approved, but the approval email needs follow-up.")} ${payload.approval_email_warning}`
            : t("quickApproval.approved", "Setup approved successfully."),
          payload.approval_email_warning ? "warning" : "info",
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : t("quickApproval.failure", "This approval could not be completed."), "danger");
        confirmButton.disabled = false;
      }
    });
  }

  loadPreview().catch((error) => {
    setStatus(error instanceof Error ? error.message : t("quickApproval.unavailable", "This quick-approval link is unavailable."), "danger");
  });
})();
