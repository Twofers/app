(() => {
  const Shell = window.TwoferAdminShell;
  let currentBusinessId = "";
  let currentReason = "account_support";

  function inject() {
    if (document.querySelector("[data-owner-email-panel]")) return;
    const backdrop = document.createElement("div");
    backdrop.className = "admin-side-panel-backdrop";
    backdrop.dataset.ownerEmailBackdrop = "";
    backdrop.hidden = true;
    const panel = document.createElement("aside");
    panel.className = "admin-side-panel admin-owner-email-panel";
    panel.dataset.ownerEmailPanel = "";
    panel.setAttribute("aria-hidden", "true");
    panel.setAttribute("aria-labelledby", "owner-email-title");
    panel.innerHTML = `
      <div class="admin-side-panel-header">
        <div><p class="admin-kicker">Owner support</p><h2 id="owner-email-title">Draft owner email</h2></div>
        <button class="button button-small button-secondary" type="button" data-owner-email-close>Close</button>
      </div>
      <ol class="admin-email-steps" aria-label="Email workflow">
        <li data-email-step="reason" class="is-active">1. Reason</li>
        <li data-email-step="draft">2. Draft</li>
        <li data-email-step="review">3. Review & send</li>
      </ol>
      <label>Contact reason
        <select data-owner-email-reason>
          <option value="setup_help">Setup help</option>
          <option value="email_verification">Email verification</option>
          <option value="billing_setup">Billing setup</option>
          <option value="offer_help">Offer help</option>
          <option value="redemption_help">Redemption help</option>
          <option value="trial_ending">Trial ending</option>
          <option value="account_support">Account support</option>
        </select>
      </label>
      <div class="admin-inline-actions">
        <button class="button button-small" type="button" data-owner-email-draft>Create draft</button>
      </div>
      <div data-owner-email-editor hidden>
        <label>Subject<input data-owner-email-subject maxlength="160" /></label>
        <label>Body<textarea data-owner-email-body rows="14" maxlength="5000"></textarea></label>
        <div class="admin-inline-actions">
          <button class="button button-small button-secondary" type="button" data-owner-email-refine="shorter">Shorter</button>
          <button class="button button-small button-secondary" type="button" data-owner-email-refine="friendlier">Friendlier</button>
          <button class="button button-small button-secondary" type="button" data-owner-email-refine="add_support_link">Add support link</button>
          <button class="button button-small button-secondary" type="button" data-owner-email-refine="regenerate">Regenerate</button>
        </div>
        <label class="admin-review-confirm"><input type="checkbox" data-owner-email-reviewed /> I reviewed and edited this exact subject and body.</label>
        <div class="admin-inline-actions">
          <button class="button button-small button-secondary" type="button" data-owner-email-save>Save without sending</button>
          <button class="button button-small" type="button" data-owner-email-send disabled>Send email</button>
        </div>
      </div>
      <p class="status" data-owner-email-status role="status" aria-live="polite"></p>
    `;
    document.body.append(backdrop, panel);

    const close = () => {
      panel.classList.remove("is-open");
      panel.setAttribute("aria-hidden", "true");
      backdrop.hidden = true;
    };
    panel.querySelector("[data-owner-email-close]").addEventListener("click", close);
    backdrop.addEventListener("click", close);
    panel.querySelector("[data-owner-email-reviewed]").addEventListener("change", (event) => {
      panel.querySelector("[data-owner-email-send]").disabled = !event.currentTarget.checked;
      setStep("review");
    });
    panel.querySelector("[data-owner-email-draft]").addEventListener("click", () => draft());
    panel.querySelector("[data-owner-email-save]").addEventListener("click", () => persist("save_draft"));
    panel.querySelector("[data-owner-email-send]").addEventListener("click", () => persist("send"));
    panel.querySelectorAll("[data-owner-email-refine]").forEach((button) => {
      button.addEventListener("click", () => draft(button.dataset.ownerEmailRefine));
    });
  }

  function panel() {
    inject();
    return document.querySelector("[data-owner-email-panel]");
  }

  function setStatus(message, tone = "") {
    const node = panel().querySelector("[data-owner-email-status]");
    node.textContent = message;
    node.className = `status${tone ? ` ${tone}` : ""}`;
  }

  function setStep(step) {
    panel().querySelectorAll("[data-email-step]").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.emailStep === step);
    });
  }

  function values() {
    const root = panel();
    return {
      reason_category: root.querySelector("[data-owner-email-reason]").value,
      subject: root.querySelector("[data-owner-email-subject]").value.trim(),
      body: root.querySelector("[data-owner-email-body]").value.trim(),
    };
  }

  async function draft(instruction = "") {
    const root = panel();
    currentReason = root.querySelector("[data-owner-email-reason]").value;
    setStatus(instruction ? "Refining the draft with verified facts…" : "Drafting from verified account facts…");
    root.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      const existing = values();
      const payload = await Shell.adminPost("admin-owner-email", {
        action: instruction ? "refine" : "draft",
        business_id: currentBusinessId,
        reason_category: currentReason,
        instruction,
        subject: existing.subject,
        body: existing.body,
      });
      root.querySelector("[data-owner-email-editor]").hidden = false;
      root.querySelector("[data-owner-email-subject]").value = payload.draft.subject;
      root.querySelector("[data-owner-email-body]").value = payload.draft.body;
      root.querySelector("[data-owner-email-reviewed]").checked = false;
      root.querySelector("[data-owner-email-send]").disabled = true;
      setStep("draft");
      setStatus(payload.draft.fallback_used
        ? "A deterministic draft is ready. Review every line before sending."
        : "AI-assisted draft ready. Review every line before sending.", "success");
    } catch (error) {
      setStatus(error.message || "Could not create the draft.", "error");
    } finally {
      root.querySelectorAll("button").forEach((button) => {
        button.disabled = button.matches("[data-owner-email-send]")
          ? !root.querySelector("[data-owner-email-reviewed]").checked
          : false;
      });
    }
  }

  async function persist(action) {
    const root = panel();
    const reviewed = root.querySelector("[data-owner-email-reviewed]").checked;
    const draftValues = values();
    if (action === "send" && !reviewed) return;
    if (action === "send" && !window.confirm("Send this exact reviewed email to the verified owner address?")) return;
    setStatus(action === "send" ? "Sending reviewed email…" : "Saving draft…");
    try {
      await Shell.adminPost("admin-owner-email", {
        action,
        business_id: currentBusinessId,
        reason_category: draftValues.reason_category,
        subject: draftValues.subject,
        body: draftValues.body,
        reviewed,
      });
      setStatus(action === "send" ? "Email sent and audited." : "Draft saved without sending.", "success");
      if (action === "send") root.querySelector("[data-owner-email-send]").disabled = true;
    } catch (error) {
      setStatus(error.message || "Could not complete the email action.", "error");
    }
  }

  function open(options = {}) {
    inject();
    currentBusinessId = String(options.businessId || "");
    if (!currentBusinessId) return;
    currentReason = options.reason || "account_support";
    const root = panel();
    root.querySelector("[data-owner-email-reason]").value = currentReason;
    root.querySelector("[data-owner-email-editor]").hidden = true;
    root.querySelector("[data-owner-email-reviewed]").checked = false;
    setStep("reason");
    setStatus("Choose why you are contacting the owner, then create a draft.");
    document.querySelector("[data-owner-email-backdrop]").hidden = false;
    root.classList.add("is-open");
    root.setAttribute("aria-hidden", "false");
    root.querySelector("[data-owner-email-reason]").focus();
  }

  window.TwoferOwnerEmail = { open };
  inject();
})();
