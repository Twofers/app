(() => {
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";

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
    pendingMfa = { session, factorId: null, remember };
    if (form) form.hidden = true;
    if (mfaPanel) mfaPanel.hidden = false;
    if (mfaQrBlock) mfaQrBlock.hidden = false;
    if (mfaPromptEl) mfaPromptEl.textContent = "Scan the QR code, then enter the 6-digit code to finish setup.";
    setMfaStatus("Setting up your authenticator...");
    try {
      const enrolled = await mfaAction({ action: "mfa_enroll", access_token: session.access_token });
      pendingMfa.factorId = enrolled.factor_id;
      if (mfaQrImg && enrolled.totp?.qr_code) mfaQrImg.src = enrolled.totp.qr_code;
      if (mfaSecretEl) mfaSecretEl.textContent = enrolled.totp?.secret || "";
      setMfaStatus("Scan the code, then enter it below.");
    } catch (error) {
      setMfaStatus(error instanceof Error ? error.message : "Could not start authenticator setup.", "danger");
    }
  }

  function beginStepUp(session, factorId, remember) {
    pendingMfa = { session, factorId, remember };
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
        setMfaStatus("Admin access verified. Opening dashboard...");
        window.location.assign("/admin");
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
          window.location.assign("/admin");
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
      window.location.assign("/admin");
    } catch (error) {
      clearSession();
      setStatus(error instanceof Error ? error.message : "Could not sign in.", "danger");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
})();
