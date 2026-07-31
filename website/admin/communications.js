(() => {
  const Shell = window.TwoferAdminShell;
  const body = document.querySelector("[data-communications-body]");

  function addCell(row, label, value) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (value instanceof Node) cell.appendChild(value);
    else cell.textContent = String(value ?? "");
    row.appendChild(cell);
  }

  function humanize(value) {
    return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function load() {
    try {
      const payload = await Shell.adminPost("admin-owner-email", { action: "list" });
      body.textContent = "";
      for (const item of payload.communications || []) {
        const row = document.createElement("tr");
        const business = Array.isArray(item.businesses) ? item.businesses[0] : item.businesses;
        addCell(row, "Business", business?.name || item.business_id);
        addCell(row, "Reason", humanize(item.reason_category));
        addCell(row, "Subject", item.subject);
        addCell(row, "Status", humanize(item.status));
        addCell(row, "Created / sent", new Date(item.sent_at || item.created_at).toLocaleString());
        const link = document.createElement("a");
        link.className = "button button-small button-secondary";
        link.href = `/admin/businesses/detail?businessId=${encodeURIComponent(item.business_id)}`;
        link.textContent = "Business";
        addCell(row, "Action", link);
        body.appendChild(row);
      }
      if (!body.children.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 6;
        cell.className = "admin-row-detail";
        cell.textContent = "No owner communications have been saved or sent.";
        row.appendChild(cell);
        body.appendChild(row);
      }
      document.querySelector("[data-admin-status]").textContent = `Signed in · ${payload.communications?.length || 0} records`;
    } catch (error) {
      document.querySelector("[data-admin-status]").textContent = error.message || "Could not load communications";
      document.querySelector("[data-admin-status]").className = "admin-badge danger";
    }
  }

  Shell.syncSessionActions();
  load();
})();
