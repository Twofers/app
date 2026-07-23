(() => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin" || path === "/admin/login") return;

  const tokenKey = "twofer_admin_access_token";
  const hasSession = window.sessionStorage.getItem(tokenKey) || window.localStorage.getItem(tokenKey);
  if (hasSession) return;

  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(`/admin/login/?next=${encodeURIComponent(next)}`);
})();
