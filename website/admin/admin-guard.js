(() => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin" || path === "/admin/login") return;
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  fetch("/api/admin/session", {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  })
    .then((response) => response.json())
    .then((payload) => {
      if (!payload?.authenticated) {
        window.location.replace(`/admin/login/?next=${encodeURIComponent(next)}`);
      }
    })
    .catch(() => {
      window.location.replace(`/admin/login/?next=${encodeURIComponent(next)}`);
    });
})();
