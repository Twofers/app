(() => {
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const pendingMfaKey = "twofer_admin_pending_mfa";

  const form = document.querySelector("[data-admin-login-form]");
  const statusEl = document.querySelector("[data-admin-login-status]");
  const clearButton = document.querySelector("[data-admin-clear-session]");
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const summaryEndpoint = document.body.dataset.adminSummaryEndpoint;
  const mfaPanel = document.querySelector("[data-mfa-panel]");
  const mfaQrBlock = document.querySelector("[data-mfa-qr-block]");
  const mfaQrImg = document.querySelector("[data-mfa-qr]");
  const mfaSecretEl = document.querySelector("[data-mfa-secret]");
  const mfaPromptEl = document.querySelector("[data-mfa-prompt]");
  const mfaCodeInput = document.querySelector("[data-mfa-code]");
  const mfaSubmitButton = document.querySelector("[data-mfa-submit]");
  const mfaStatusEl = document.querySelector("[data-mfa-status]");
  let pendingMfa = null;

  function mfaFactorId(payload) {
    return payload?.factor_id || payload?.id || payload?.factor?.id || null;
  }

  function qrImageSrc(value) {
    if (!value || typeof value !== "string") return "";
    const trimmed = value.trim();
    if (/^(data:image\/|https?:|blob:)/i.test(trimmed)) return trimmed;
    if (trimmed.startsWith("<svg")) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
    }
    return "";
  }

  function otpAuthUri(secret) {
    if (!secret || typeof secret !== "string") return "";
    const label = encodeURIComponent("Twofer Admin");
    const issuer = encodeURIComponent("Twofer");
    return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}`;
  }

  async function renderQrCode(value) {
    if (!mfaQrImg || !value) return false;
    if (!window.QRCode?.toDataURL) return false;
    try {
      mfaQrImg.src = await window.QRCode.toDataURL(value, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 200,
        color: {
          dark: "#081f18",
          light: "#ffffff",
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  function savePendingMfa(state) {
    pendingMfa = state;
    try {
      window.sessionStorage.setItem(pendingMfaKey, JSON.stringify(state));
    } catch {
      // Losing this only means the user needs to restart MFA setup.
    }
  }

  function clearPendingMfa() {
    pendingMfa = null;
    window.sessionStorage.removeItem(pendingMfaKey);
  }

  function readPendingMfa() {
    try {
      const raw = window.sessionStorage.getItem(pendingMfaKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.session?.access_token ? parsed : null;
    } catch {
      return null;
    }
  }

  function adminDestination() {
    const requested = new URLSearchParams(window.location.search).get("next") || "";
    if (!(requested === "/admin" || requested.startsWith("/admin/")) || requested.startsWith("/admin/login") || requested.startsWith("//")) {
      return "/admin";
    }
    try {
      const destination = new URL(requested, window.location.origin);
      const isAdminPath = destination.pathname === "/admin" || destination.pathname.startsWith("/admin/");
      return destination.origin === window.location.origin && isAdminPath
        ? `${destination.pathname}${destination.search}${destination.hash}`
        : "/admin";
    } catch {
      return "/admin";
    }
  }

  function openAdmin() {
    window.location.assign(adminDestination());
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status${tone === "danger" ? " error" : ""}`;
  }

  function setMfaStatus(message, tone = "info") {
    if (!mfaStatusEl) return;
    mfaStatusEl.textContent = message;
    mfaStatusEl.className = `status${tone === "danger" ? " error" : ""}`;
  }

  function clearSession() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      storage.removeItem(tokenKey);
      storage.removeItem(refreshTokenKey);
      storage.removeItem(expiresAtKey);
    }
    clearPendingMfa();
  }

  function storeSession(session, remember) {
    const primary = remember ? window.localStorage : window.sessionStorage;
    const secondary = remember ? window.sessionStorage : window.localStorage;
    secondary.removeItem(tokenKey);
    secondary.removeItem(refreshTokenKey);
    secondary.removeItem(expiresAtKey);

    primary.setItem(tokenKey, session.access_token);
    if (session.refresh_token) primary.setItem(refreshTokenKey, session.refresh_token);
    if (session.expires_in) {
      const expiresAt = Date.now() + Number(session.expires_in) * 1000;
      primary.setItem(expiresAtKey, String(expiresAt));
    }
  }

  function readStoredSession() {
    const storage = window.localStorage.getItem(tokenKey) ? window.localStorage : window.sessionStorage;
    const accessToken = storage.getItem(tokenKey);
    const refreshToken = storage.getItem(refreshTokenKey);
    const expiresAt = Number(storage.getItem(expiresAtKey) || "0");
    return { accessToken, refreshToken, expiresAt, remember: storage === window.localStorage };
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  function configIsMissing() {
    return (
      !authEndpoint ||
      !summaryEndpoint
    );
  }

  async function signIn(email, password) {
    const response = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok || !payload.session?.access_token) {
      throw new Error(payload.error || "Sign in failed.");
    }
    return payload;
  }

  async function mfaAction(body) {
    const response = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Verification failed.");
    return payload;
  }

  async function beginEnrollment(session, remember) {
    savePendingMfa({ session, factorId: null, remember });
    if (form) form.hidden = true;
    if (mfaPanel) mfaPanel.hidden = false;
    if (mfaQrBlock) mfaQrBlock.hidden = false;
    if (mfaPromptEl) mfaPromptEl.textContent = "Scan the QR code, then enter the 6-digit code to finish setup.";
    setMfaStatus("Setting up your authenticator...");
    try {
      const enrolled = await mfaAction({ action: "mfa_enroll", access_token: session.access_token });
      const factorId = mfaFactorId(enrolled);
      if (!factorId) throw new Error("Authenticator setup did not finish. Refresh this page and sign in again.");
      savePendingMfa({ session, factorId, remember });
      const qrSrc = qrImageSrc(enrolled.totp?.qr_code);
      if (mfaQrImg && qrSrc) mfaQrImg.src = qrSrc;
      const secret = enrolled.totp?.secret || "";
      if (mfaSecretEl) mfaSecretEl.textContent = secret;
      if (!qrSrc) {
        await renderQrCode(enrolled.totp?.uri || otpAuthUri(secret));
      }
      setMfaStatus("Scan the QR code or enter the setup key manually, then enter the 6-digit code below.");
    } catch (error) {
      clearPendingMfa();
      setMfaStatus(error instanceof Error ? error.message : "Could not start authenticator setup.", "danger");
    }
  }

  function beginStepUp(session, factorId, remember) {
    savePendingMfa({ session, factorId, remember });
    if (form) form.hidden = true;
    if (mfaPanel) mfaPanel.hidden = false;
    if (mfaQrBlock) mfaQrBlock.hidden = true;
    if (mfaPromptEl) mfaPromptEl.textContent = "Enter the 6-digit code from your authenticator app.";
    setMfaStatus("");
  }

  if (mfaSubmitButton) {
    mfaSubmitButton.addEventListener("click", async () => {
      if (!pendingMfa?.factorId) {
        setMfaStatus("Still setting up your authenticator. Please wait.", "danger");
        return;
      }
      const code = (mfaCodeInput?.value || "").trim();
      if (!code) {
        setMfaStatus("Enter the 6-digit code.", "danger");
        return;
      }
      mfaSubmitButton.disabled = true;
      setMfaStatus("Verifying...");
      try {
        const verified = await mfaAction({
          action: "mfa_verify",
          access_token: pendingMfa.session.access_token,
          factor_id: pendingMfa.factorId,
          code,
        });
        await verifyAdmin(verified.session.access_token);
        storeSession(verified.session, pendingMfa.remember);
        clearPendingMfa();
        setMfaStatus("Admin access verified. Opening dashboard...");
        openAdmin();
      } catch (error) {
        setMfaStatus(error instanceof Error ? error.message : "Incorrect code. Try again.", "danger");
      } finally {
        mfaSubmitButton.disabled = false;
      }
    });
  }

  async function refreshSession(refreshToken) {
    const response = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok || !payload.session?.access_token) {
      throw new Error(payload.error || "Session refresh failed.");
    }
    return payload.session;
  }

  async function verifyAdmin(accessToken) {
    const response = await fetch(summaryEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "This account is not active in the admin allowlist.");
    }
    return payload;
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      clearSession();
      setStatus("Saved admin session cleared.");
    });
  }

  if (!form) return;

  const restoredMfa = readPendingMfa();
  if (restoredMfa?.factorId) {
    beginStepUp(restoredMfa.session, restoredMfa.factorId, Boolean(restoredMfa.remember));
  }

  if (configIsMissing()) {
    setStatus("Admin login is missing the admin auth endpoint configuration.", "danger");
  } else {
    const stored = readStoredSession();
    if (stored.accessToken && stored.refreshToken) {
      setStatus("Checking saved admin session...");
      Promise.resolve()
        .then(async () => {
          let accessToken = stored.accessToken;
          if (stored.expiresAt && stored.expiresAt - Date.now() < 60000) {
            const refreshed = await refreshSession(stored.refreshToken);
            storeSession(refreshed, stored.remember);
            accessToken = refreshed.access_token;
          }
          await verifyAdmin(accessToken);
          setStatus("Saved admin session verified. Opening dashboard...");
          openAdmin();
        })
        .catch(() => {
          clearSession();
          setStatus("Saved admin session expired. Sign in again.");
        });
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (configIsMissing()) {
      setStatus("Admin login is missing the admin auth endpoint configuration.", "danger");
      return;
    }

    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const remember = data.get("remember") === "on";

    if (!email || !password) {
      setStatus("Enter your admin email and password.", "danger");
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    setStatus("Signing in...");

    try {
      const result = await signIn(email, password);
      if (result.mfa_enrollment_required) {
        setStatus("Authenticator setup required.");
        await beginEnrollment(result.session, remember);
        return;
      }
      if (result.mfa_required) {
        setStatus("Verification code required.");
        beginStepUp(result.session, result.factor_id, remember);
        return;
      }
      setStatus("Verifying admin access...");
      await verifyAdmin(result.session.access_token);
      storeSession(result.session, remember);
      setStatus("Admin access verified. Opening dashboard...");
      openAdmin();
    } catch (error) {
      clearSession();
      setStatus(error instanceof Error ? error.message : "Could not sign in.", "danger");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
})();
