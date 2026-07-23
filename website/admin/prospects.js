(() => {
  const body = document.body;
  const section = body.dataset.adminSection;
  const authEndpoint = body.dataset.adminAuthEndpoint;
  const summaryEndpoint = body.dataset.adminSummaryEndpoint;
  const endpoints = {
    import: body.dataset.adminProspectImportEndpoint,
    enrich: body.dataset.adminProspectEnrichEndpoint,
    score: body.dataset.adminProspectScoreEndpoint,
    demand: body.dataset.adminDemandProofEndpoint,
    sales: body.dataset.adminProspectSalesEndpoint,
    script: body.dataset.adminSalesScriptEndpoint,
    claim: body.dataset.adminClaimLinkEndpoint,
    claimAssistant: body.dataset.adminClaimLinkAssistantEndpoint,
    trial: body.dataset.adminTrialFromProspectEndpoint,
    trialAssistant: body.dataset.adminTrialConversionAssistantEndpoint,
  };
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  let latestDetailPayload = null;

  function storageSource() {
    return window.localStorage.getItem(tokenKey) ? window.localStorage : window.sessionStorage;
  }

  function syncNav() {
    const hasToken = Boolean(storageSource().getItem(tokenKey));
    if (loginLink) loginLink.hidden = hasToken;
    if (signOutButton) signOutButton.hidden = !hasToken;
  }

  function clearSession() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      storage.removeItem(tokenKey);
      storage.removeItem(refreshTokenKey);
      storage.removeItem(expiresAtKey);
    }
    syncNav();
  }

  function storeSession(session, storage) {
    storage.setItem(tokenKey, session.access_token);
    if (session.refresh_token) storage.setItem(refreshTokenKey, session.refresh_token);
    if (session.expires_in) storage.setItem(expiresAtKey, String(Date.now() + Number(session.expires_in) * 1000));
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function refreshSession(refreshToken, storage) {
    const response = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok || !payload.session?.access_token) throw new Error("Session refresh failed.");
    storeSession(payload.session, storage);
    return payload.session.access_token;
  }

  async function getToken() {
    const storage = storageSource();
    const token = storage.getItem(tokenKey);
    const refreshToken = storage.getItem(refreshTokenKey);
    const expiresAt = Number(storage.getItem(expiresAtKey) || "0");
    if (!token) return null;
    if (!refreshToken || !authEndpoint) return token;
    if (expiresAt && expiresAt - Date.now() > 60000) return token;
    return refreshSession(refreshToken, storage);
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function setOutput(selector, message, tone = "info") {
    const node = document.querySelector(selector);
    if (!node) return;
    node.textContent = message;
    node.className = `status${tone === "danger" ? " error" : ""}`;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function labelState(value) {
    return {
      not_on_twofer_yet: "Not on Twofer yet",
      on_twofer: "On Twofer",
      live_offer_available: "Live offer available",
    }[value] || value || "";
  }

  function getProspectId() {
    const query = new URLSearchParams(window.location.search).get("prospectId");
    if (query) return query;
    const segments = window.location.pathname.split("/").filter(Boolean);
    const index = segments.indexOf("prospects");
    return index >= 0 ? segments[index + 1] || "" : "";
  }

  async function post(url, body) {
    const token = await getToken();
    if (!token) throw new Error("Admin session not connected.");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error(payload.error || "Admin session expired. Sign in again.");
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  async function loadSummary(bodyPayload) {
    if (!summaryEndpoint) return {};
    return post(summaryEndpoint, bodyPayload);
  }

  function cell(tr, label, text) {
    const td = document.createElement("td");
    td.dataset.label = label;
    td.textContent = text == null ? "" : String(text);
    tr.appendChild(td);
    return td;
  }

  function renderProspects(rows) {
    const tbody = document.querySelector("[data-prospects-body]");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 10;
      td.className = "admin-row-detail";
      td.textContent = "No prospects match those filters.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement("tr");
      const nameTd = cell(tr, "Business", "");
      const link = document.createElement("a");
      link.href = `/admin/prospects/${row.id}`;
      link.textContent = row.display_name || row.id;
      nameTd.appendChild(link);
      cell(tr, "City", [row.city, row.state].filter(Boolean).join(", "));
      cell(tr, "Category", row.category || "");
      cell(tr, "Public state", labelState(row.public_label_state));
      cell(tr, "Demand", row.demand_count ?? 0);
      cell(tr, "Score", row.score ? `${row.score.total_score} / ${row.score.tier}` : "");
      cell(tr, "Stage", row.sales_account?.stage || row.status || "");
      cell(tr, "Next action", row.sales_account?.next_action || row.score?.recommended_next_action || "");
      cell(tr, "Last contact", formatDate(row.sales_account?.last_contact_at));
      cell(tr, "Linked business", row.linked_business?.name || "");
      tbody.appendChild(tr);
    }
  }

  async function loadProspects() {
    const form = document.querySelector("[data-prospect-filter-form]");
    const formData = form ? new FormData(form) : new FormData();
    setStatus("Loading prospects");
    const payload = await loadSummary({
      section: "prospects",
      search: formData.get("search") || "",
      city: formData.get("city") || "",
      status: formData.get("status") || "",
      review_status: formData.get("review_status") || "",
      score_tier: formData.get("score_tier") || "",
    });
    setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
    renderProspects(payload.prospects || []);
  }

  function renderList(selector, rows, columns, emptyText) {
    const tbody = document.querySelector(selector);
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length;
      td.className = "admin-row-detail";
      td.textContent = emptyText;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const column of columns) cell(tr, column.label, column.value(row));
      tbody.appendChild(tr);
    }
  }

  function fillText(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function latestEnrichment() {
    const rows = latestDetailPayload?.enrichments || [];
    return rows.length ? rows[0] : null;
  }

  function latestEnrichmentJson() {
    const row = latestEnrichment();
    return row?.enrichment_json && typeof row.enrichment_json === "object" ? row.enrichment_json : null;
  }

  function selectedFactsFromLatest() {
    const json = latestEnrichmentJson() || {};
    return {
      display_name: json.cleaned_business_name || json.public_facts?.display_name || "",
      category: json.likely_business_category || json.public_facts?.category || "",
      subcategory: json.public_facts?.subcategory || "",
      city: json.public_facts?.city || "",
    };
  }

  function stringifyAssistant(value) {
    if (!value || typeof value !== "object") return "";
    return Object.entries(value)
      .filter(([key]) => !["sources", "model", "provider", "prompt_version"].includes(key))
      .map(([key, nested]) => `${key.replaceAll("_", " ")}:\n${Array.isArray(nested) ? nested.join("\n") : typeof nested === "object" ? JSON.stringify(nested, null, 2) : nested}`)
      .join("\n\n");
  }

  async function copyFrom(selector, statusSelector) {
    const node = document.querySelector(selector);
    const text = node?.textContent || "";
    if (!text.trim()) {
      setOutput(statusSelector, "Nothing to copy yet.", "danger");
      return;
    }
    await navigator.clipboard.writeText(text);
    setOutput(statusSelector, "Copied.");
  }

  async function loadDetail() {
    const prospectId = getProspectId();
    if (!prospectId) {
      setStatus("Prospect id missing", "danger");
      return;
    }
    setStatus("Loading prospect");
    const payload = await loadSummary({ section: "prospect_detail", prospect_id: prospectId });
    latestDetailPayload = payload;
    setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
    const prospect = payload.prospect;
    if (!prospect) {
      fillText("[data-prospect-title]", "Prospect not found");
      return;
    }
    fillText("[data-prospect-title]", prospect.display_name);
    fillText("[data-prospect-meta]", `${[prospect.city, prospect.state, prospect.postal_code].filter(Boolean).join(", ")} | ${prospect.category || "Uncategorized"} | ${labelState(prospect.public_label_state)}`);
    fillText("[data-prospect-status]", `${String(prospect.status || "").replace(/_/g, " ")} / ${String(prospect.review_status || "").replace(/_/g, " ")}`);
    fillText("[data-prospect-linked]", payload.linked_business?.name || "Not linked");
    fillText("[data-prospect-billing]", payload.billing ? `${payload.billing.app_access_status || ""} ${payload.billing.billing_status || ""}`.trim() : "No billing record");
    fillText("[data-prospect-private-contact]", JSON.stringify(prospect.private_contact_json || {}, null, 2));
    fillText("[data-enrichment-json]", latestEnrichmentJson() ? JSON.stringify(latestEnrichmentJson(), null, 2) : "Run AI enrichment to draft reviewable facts.");

    renderList("[data-sources-body]", payload.sources || [], [
      { label: "Provider", value: (r) => r.provider },
      { label: "URL", value: (r) => r.source_url || "" },
      { label: "Hash", value: (r) => r.source_payload_hash || "" },
      { label: "Confidence", value: (r) => r.confidence ?? "" },
      { label: "Fetched", value: (r) => formatDate(r.fetched_at) },
      { label: "Stale", value: (r) => formatDate(r.stale_at) },
    ], "No sources yet.");
    renderList("[data-enrichments-body]", payload.enrichments || [], [
      { label: "Provider", value: (r) => r.provider },
      { label: "Model", value: (r) => r.model || "" },
      { label: "Review", value: (r) => r.review_status || "" },
      { label: "Confidence", value: (r) => r.confidence ?? "" },
      { label: "Created", value: (r) => formatDate(r.created_at) },
    ], "No enrichments yet.");
    renderList("[data-scores-body]", payload.scores || [], [
      { label: "Score", value: (r) => `${r.total_score} / ${r.tier}` },
      { label: "Version", value: (r) => r.score_version || "" },
      { label: "Next action", value: (r) => r.recommended_next_action || "" },
      { label: "Created", value: (r) => formatDate(r.created_at) },
    ], "No scores yet.");
    renderList("[data-demand-body]", payload.demand_rollups || [], [
      { label: "Date", value: (r) => r.rollup_date || "" },
      { label: "Requests", value: (r) => r.requests_count ?? 0 },
      { label: "Favorites", value: (r) => r.favorites_count ?? 0 },
      { label: "Views", value: (r) => r.views_count ?? 0 },
      { label: "Unique", value: (r) => r.unique_users_count ?? 0 },
    ], "No demand rollups yet.");
    renderList("[data-activities-body]", payload.sales_activities || [], [
      { label: "Type", value: (r) => r.activity_type || "" },
      { label: "Summary", value: (r) => r.summary || "" },
      { label: "Outcome", value: (r) => r.outcome || "" },
      { label: "Created", value: (r) => formatDate(r.created_at) },
    ], "No sales activity yet.");
    renderList("[data-claim-links-body]", payload.claim_links || [], [
      { label: "Created", value: (r) => formatDate(r.created_at) },
      { label: "Expires", value: (r) => formatDate(r.expires_at) },
      { label: "Uses", value: (r) => `${r.uses_count || 0}/${r.max_uses || 1}` },
      { label: "Accepted", value: (r) => formatDate(r.accepted_at) },
      { label: "Revoked", value: (r) => formatDate(r.revoked_at) },
    ], "No claim links yet.");
    renderList("[data-conversions-body]", payload.conversions || [], [
      { label: "Type", value: (r) => r.conversion_type || "" },
      { label: "Application", value: (r) => r.business_application_id || "" },
      { label: "Business", value: (r) => r.business_id || "" },
      { label: "Created", value: (r) => formatDate(r.created_at) },
    ], "No conversion history yet.");
    renderList("[data-audit-body]", payload.audit_log || [], [
      { label: "Admin", value: (r) => r.admin_email || "" },
      { label: "Action", value: (r) => r.action || "" },
      { label: "Reason", value: (r) => r.reason || "" },
      { label: "Created", value: (r) => formatDate(r.created_at) },
    ], "No audit events yet.");

    const sales = payload.sales_account || {};
    const salesForm = document.querySelector("[data-sales-form]");
    if (salesForm) {
      salesForm.stage.value = sales.stage || "new";
      salesForm.priority.value = sales.priority || "normal";
      salesForm.next_action.value = sales.next_action || "";
      salesForm.notes.value = sales.notes || "";
    }
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((value) => value.trim());
    return lines.slice(1).map((line) => {
      const values = line.split(",").map((value) => value.trim());
      return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    });
  }

  async function handleImport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const csvRows = parseCsv(String(data.get("csv") || ""));
    const manual = Object.fromEntries([...data.entries()].filter(([key]) => key !== "csv"));
    if (manual.private_contact_json) {
      try {
        manual.private_contact_json = JSON.parse(String(manual.private_contact_json));
      } catch {
        manual.private_contact_json = {};
      }
    }
    const prospects = csvRows.length ? csvRows : [manual];
    setOutput("[data-import-status]", "Importing prospects...");
    const payload = await post(endpoints.import, { prospects, reason: data.get("reason") || "admin_import" });
    setOutput("[data-import-status]", `Imported ${payload.prospects?.length || 0} prospect record(s).`);
    form.reset();
  }

  function bindDetailActions() {
    const prospectId = getProspectId();
    const actionMap = [
      ["[data-enrich-button]", endpoints.enrich, { prospect_id: prospectId, review_status: "needs_review", mode: "quick" }, "[data-action-status]", "Enrichment saved."],
      ["[data-enrich-refresh-button]", endpoints.enrich, { prospect_id: prospectId, review_status: "needs_review", mode: "refresh" }, "[data-action-status]", "Enrichment refreshed."],
      ["[data-score-button]", endpoints.score, { prospect_id: prospectId }, "[data-action-status]", "Score saved."],
      ["[data-demand-proof-button]", endpoints.demand, { prospect_id: prospectId }, "[data-demand-proof-output]", ""],
      ["[data-sales-script-button]", endpoints.script, { prospect_id: prospectId, script_type: "call" }, "[data-sales-script-output]", ""],
      ["[data-claim-link-assistant-button]", endpoints.claimAssistant, { prospect_id: prospectId }, "[data-claim-link-assistant-output]", ""],
      ["[data-trial-conversion-assistant-button]", endpoints.trialAssistant, { prospect_id: prospectId }, "[data-trial-conversion-output]", ""],
    ];
    for (const [selector, url, payload, output, success] of actionMap) {
      const button = document.querySelector(selector);
      if (!button || !url) continue;
      button.addEventListener("click", async () => {
        try {
          setOutput(output, "Working...");
          const result = await post(url, payload);
          if (selector.includes("demand")) {
            setOutput(output, [
              ...(result.report?.merchant_safe_lines || []),
              "",
              "In-person pitch:",
              result.report?.exports?.in_person_pitch || "",
              "",
              "Email pitch:",
              result.report?.exports?.email_pitch || "",
              "",
              "Text message pitch:",
              result.report?.exports?.text_message_pitch || "",
              "",
              "Owner summary:",
              result.report?.exports?.owner_summary || "",
              "",
              "Internal notes:",
              result.report?.exports?.internal_notes || "",
            ].filter((line) => line !== undefined).join("\n"));
          } else if (selector.includes("script")) {
            setOutput(output, result.script_bundle ? stringifyAssistant(result.script_bundle) : result.script || "");
          } else if (selector.includes("claim-link-assistant")) {
            setOutput(output, stringifyAssistant(result.assistant));
          } else if (selector.includes("trial-conversion-assistant")) {
            setOutput(output, stringifyAssistant(result.assistant));
          } else {
            setOutput(output, success);
            await loadDetail();
          }
        } catch (error) {
          setOutput(output, error instanceof Error ? error.message : "Request failed.", "danger");
        }
      });
    }

    const claimForm = document.querySelector("[data-claim-link-form]");
    if (claimForm) {
      claimForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(claimForm);
        try {
          setOutput("[data-claim-link-status]", "Creating claim link...");
          const payload = await post(endpoints.claim, {
            action: "create",
            prospect_id: prospectId,
            expires_in_days: data.get("expires_in_days"),
            max_uses: data.get("max_uses"),
            reason: data.get("reason"),
          });
          setOutput("[data-claim-link-status]", `Claim URL: ${payload.claim_url}`);
          await loadDetail();
        } catch (error) {
          setOutput("[data-claim-link-status]", error instanceof Error ? error.message : "Could not create claim link.", "danger");
        }
      });
    }

    const salesForm = document.querySelector("[data-sales-form]");
    if (salesForm) {
      salesForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(salesForm);
        try {
          setOutput("[data-sales-status]", "Saving sales account...");
          await post(endpoints.sales, {
            action: "update_account",
            prospect_id: prospectId,
            stage: data.get("stage"),
            priority: data.get("priority"),
            next_action: data.get("next_action"),
            notes: data.get("notes"),
          });
          setOutput("[data-sales-status]", "Sales account saved.");
          await loadDetail();
        } catch (error) {
          setOutput("[data-sales-status]", error instanceof Error ? error.message : "Could not save sales account.", "danger");
        }
      });
    }

    const activityForm = document.querySelector("[data-activity-form]");
    if (activityForm) {
      activityForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(activityForm);
        try {
          setOutput("[data-activity-status]", "Logging activity...");
          await post(endpoints.sales, {
            action: "log_activity",
            prospect_id: prospectId,
            activity_type: data.get("activity_type"),
            summary: data.get("summary"),
            outcome: data.get("outcome"),
          });
          setOutput("[data-activity-status]", "Activity logged.");
          activityForm.reset();
          await loadDetail();
        } catch (error) {
          setOutput("[data-activity-status]", error instanceof Error ? error.message : "Could not log activity.", "danger");
        }
      });
    }

    const trialForm = document.querySelector("[data-trial-from-prospect-form]");
    if (trialForm) {
      trialForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(trialForm);
        try {
          setOutput("[data-trial-status]", "Creating setup approval...");
          const payload = await post(endpoints.trial, {
            prospect_id: prospectId,
            contact_name: data.get("contact_name"),
            email: data.get("email"),
            phone: data.get("phone"),
            decision: data.get("decision"),
            reason: data.get("reason"),
          });
          setOutput("[data-trial-status]", `Setup approval ${payload.application?.id || ""} created.`);
          await loadDetail();
        } catch (error) {
          setOutput("[data-trial-status]", error instanceof Error ? error.message : "Could not create setup approval.", "danger");
        }
      });
      }
    }

    const reviewButton = document.querySelector("[data-review-ai-facts-button]");
    if (reviewButton) {
      reviewButton.addEventListener("click", () => {
        setOutput("[data-enrichment-json]", latestEnrichmentJson() ? JSON.stringify(latestEnrichmentJson(), null, 2) : "Run AI enrichment first.");
      });
    }

    for (const [selector, action, message] of [
      ["[data-approve-ai-facts-button]", "approve_selected_facts", "Selected AI facts approved."],
      ["[data-reject-ai-facts-button]", "reject_ai_facts", "AI facts rejected."],
      ["[data-manual-research-button]", "mark_needs_manual_research", "Prospect marked for manual research."],
    ]) {
      const button = document.querySelector(selector);
      if (!button || !endpoints.enrich) continue;
      button.addEventListener("click", async () => {
        try {
          const enrichment = latestEnrichment();
          if (!enrichment?.id) {
            setOutput("[data-action-status]", "Run AI enrichment first.", "danger");
            return;
          }
          setOutput("[data-action-status]", "Saving review...");
          await post(endpoints.enrich, {
            action,
            prospect_id: prospectId,
            enrichment_id: enrichment.id,
            selected_facts: action === "approve_selected_facts" ? selectedFactsFromLatest() : {},
          });
          setOutput("[data-action-status]", message);
          await loadDetail();
        } catch (error) {
          setOutput("[data-action-status]", error instanceof Error ? error.message : "Could not save review.", "danger");
        }
      });
    }

    const copyDemand = document.querySelector("[data-copy-demand-proof]");
    if (copyDemand) {
      copyDemand.addEventListener("click", () => {
        copyFrom("[data-demand-proof-output]", "[data-action-status]").catch((error) =>
          setOutput("[data-action-status]", error instanceof Error ? error.message : "Copy failed.", "danger")
        );
      });
    }
    const copyScript = document.querySelector("[data-copy-sales-script]");
    if (copyScript) {
      copyScript.addEventListener("click", () => {
        copyFrom("[data-sales-script-output]", "[data-action-status]").catch((error) =>
          setOutput("[data-action-status]", error instanceof Error ? error.message : "Copy failed.", "danger")
        );
      });
    }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  const filterForm = document.querySelector("[data-prospect-filter-form]");
  if (filterForm) {
    filterForm.addEventListener("submit", (event) => {
      event.preventDefault();
      loadProspects().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load prospects.", "danger"));
    });
  }

  const importForm = document.querySelector("[data-prospect-import-form]");
  if (importForm) {
    importForm.addEventListener("submit", (event) => {
      handleImport(event).catch((error) => setOutput("[data-import-status]", error instanceof Error ? error.message : "Import failed.", "danger"));
    });
  }

  syncNav();
  if (section === "prospects") loadProspects().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load prospects.", "danger"));
  if (section === "prospect_detail") {
    bindDetailActions();
    loadDetail().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load prospect.", "danger"));
  }
})();
