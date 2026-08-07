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
    return Shell.formatOptionLabel(value || "unknown");
  }

  function businessLink(id, name) {
    if (!id) return name || "Unknown business";
    const link = document.createElement("a");
    link.href = `/admin/businesses/detail?businessId=${encodeURIComponent(id)}`;
    link.textContent = name || "Business record";
    return link;
  }

  async function load() {
    try {
      const payload = await Shell.adminPost("admin-owner-email", { action: "list" });
      body.textContent = "";
      for (const item of payload.communications || []) {
        const row = document.createElement("tr");
        const business = Array.isArray(item.businesses) ? item.businesses[0] : item.businesses;
        addCell(row, "Business", businessLink(item.business_id, business?.name));
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
