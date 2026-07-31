(() => {
  const Shell = window.TwoferAdminShell;
  const $ = (selector) => document.querySelector(selector);
  const humanize = (value) => String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

  function status(message, tone = "") {
    const node = $("[data-ai-usage-status]");
    node.textContent = message;
    node.className = `status${tone ? ` ${tone}` : ""}`;
  }

  async function resetQuota(business, scope) {
    const reason = window.prompt(`Reason for resetting ${humanize(scope)} for ${business.name}:`) || "";
    if (reason.trim().length < 5) return;
    if (!window.confirm("Reset this monthly quota counter? This action is audited.")) return;
    try {
      await Shell.adminPost("admin-ai-usage", {
        action: "reset_quota",
        business_id: business.id,
        quota_scope: scope,
        reason: reason.trim(),
      });
      status("Quota reset completed and audited.", "success");
      $("[data-ai-lookup-form]").requestSubmit();
    } catch (error) {
      status(error.message || "Could not reset the quota.", "error");
    }
  }

  function render(payload) {
    const section = $("[data-ai-usage-results]");
    const container = $("[data-ai-businesses]");
    section.hidden = false;
    $("[data-ai-owner]").textContent = payload.user?.email || "Owner usage";
    container.textContent = "";
    for (const business of payload.businesses || []) {
      const article = document.createElement("article");
      article.className = "admin-panel";
      const heading = document.createElement("h3");
      heading.textContent = business.name || business.id;
      article.appendChild(heading);
      const wrap = document.createElement("div");
      wrap.className = "admin-table-wrap";
      const table = document.createElement("table");
      table.className = "admin-table";
      table.dataset.mobileCards = "";
      table.innerHTML = "<thead><tr><th>Quota</th><th>Used</th><th>Limit</th><th>Remaining</th><th>Resets</th><th>Action</th></tr></thead>";
      const body = document.createElement("tbody");
      for (const item of business.usage || []) {
        const row = document.createElement("tr");
        const values = [
          ["Quota", humanize(item.scope)],
          ["Used", item.used],
          ["Limit", item.limit],
          ["Remaining", item.remaining],
          ["Resets", item.resetAt ? new Date(item.resetAt).toLocaleString() : "No reset"],
        ];
        for (const [label, value] of values) {
          const cell = document.createElement("td");
          cell.dataset.label = label;
          cell.textContent = String(value);
          row.appendChild(cell);
        }
        const actionCell = document.createElement("td");
        actionCell.dataset.label = "Action";
        const button = document.createElement("button");
        button.className = "button button-small button-secondary";
        button.type = "button";
        button.textContent = "Reset quota";
        button.addEventListener("click", () => resetQuota(business, item.scope));
        actionCell.appendChild(button);
        row.appendChild(actionCell);
        body.appendChild(row);
      }
      table.appendChild(body);
      wrap.appendChild(table);
      article.appendChild(wrap);
      container.appendChild(article);
    }
    if (!container.children.length) {
      const empty = document.createElement("p");
      empty.className = "admin-note";
      empty.textContent = "No business AI usage was found for this account.";
      container.appendChild(empty);
    }
  }

  $("[data-ai-lookup-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") || "").trim();
    status("Loading current quota usage…");
    try {
      const payload = await Shell.adminPost("admin-ai-usage", { action: "lookup", query });
      render(payload);
      status("Current AI usage loaded.", "success");
    } catch (error) {
      status(error.message || "Could not load AI usage.", "error");
    }
  });
  Shell.syncSessionActions();
})();
