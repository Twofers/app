(() => {
  const sessionEndpoint = "/api/admin/session";
  const form = document.querySelector("[data-admin-login-form]");
  const statusEl = document.querySelector("[data-admin-login-status]");
  const clearButton = document.querySelector("[data-admin-clear-session]");
  const mfaPanel = document.querySelector("[data-mfa-panel]");
  const mfaQrBlock = document.querySelector("[data-mfa-qr-block]");
  const mfaQrImg = document.querySelector("[data-mfa-qr]");
  const mfaSecretEl = document.querySelector("[data-mfa-secret]");
  const mfaPromptEl = document.querySelector("[data-mfa-prompt]");
  const mfaCodeInput = document.querySelector("[data-mfa-code]");
  const mfaSubmitButton = document.querySelector("[data-mfa-submit]");
  const mfaStatusEl = document.querySelector("[data-mfa-status]");
  let pendingFactorId = null;

  function adminDestination() {
    const requested = new URLSearchParams(window.location.search).get("next") || "";
    if (!(requested === "/admin" || requested.startsWith("/admin/")) || requested.startsWith("/admin/login") || requested.startsWith("//")) {
      return "/admin";
    }
    try {
      const destination = new URL(requested, window.location.origin);
      return destination.origin === window.location.origin
        ? `${destination.pathname}${destination.search}${destination.hash}`
        : "/admin";
    } catch {
      return "/admin";
    }
  }

  function setStatus(message, danger = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status${danger ? " error" : ""}`;
  }

  function setMfaStatus(message, danger = false) {
    if (!mfaStatusEl) return;
    mfaStatusEl.textContent = message;
    mfaStatusEl.className = `status${danger ? " error" : ""}`;
  }

  async function request(method, body) {
    const response = await fetch(sessionEndpoint, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "Admin session request failed.");
    }
    return payload;
  }

  async function clearSession() {
    pendingFactorId = null;
    await request("DELETE").catch(() => {});
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

  async function renderQrCode(value) {
    if (!mfaQrImg || !value || !window.QRCode?.toDataURL) return;
    mfaQrImg.src = await window.QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 200,
      color: { dark: "#081f18", light: "#ffffff" },
    });
  }

  async function beginEnrollment() {
    if (form) form.hidden = true;
    if (mfaPanel) mfaPanel.hidden = false;
    if (mfaQrBlock) mfaQrBlock.hidden = false;
    if (mfaPromptEl) mfaPromptEl.textContent = "Scan the QR code, then enter the 6-digit code to finish setup.";
    setMfaStatus("Setting up your authenticator...");
    const enrolled = await request("POST", { action: "mfa_enroll" });
    pendingFactorId = enrolled.factor_id;
    const qrSrc = qrImageSrc(enrolled.totp?.qr_code);
    if (mfaQrImg && qrSrc) mfaQrImg.src = qrSrc;
    const secret = enrolled.totp?.secret || "";
    if (mfaSecretEl) mfaSecretEl.textContent = secret;
    if (!qrSrc) await renderQrCode(enrolled.totp?.uri);
    setMfaStatus("Enter the 6-digit code from your authenticator app.");
  }

  function beginStepUp(factorId) {
    pendingFactorId = factorId;
    if (form) form.hidden = true;
    if (mfaPanel) mfaPanel.hidden = false;
    if (mfaQrBlock) mfaQrBlock.hidden = true;
    if (mfaPromptEl) mfaPromptEl.textContent = "Enter the 6-digit code from your authenticator app.";
    setMfaStatus("");
  }

  mfaSubmitButton?.addEventListener("click", async () => {
    const code = String(mfaCodeInput?.value || "").trim();
    if (!pendingFactorId || !code) {
      setMfaStatus("Enter the 6-digit code.", true);
      return;
    }
    mfaSubmitButton.disabled = true;
    setMfaStatus("Verifying...");
    try {
      await request("POST", { action: "mfa_verify", factor_id: pendingFactorId, code });
      window.location.assign(adminDestination());
    } catch (error) {
      setMfaStatus(error.message || "Incorrect code. Try again.", true);
    } finally {
      mfaSubmitButton.disabled = false;
    }
  });

  clearButton?.addEventListener("click", async () => {
    await clearSession();
    setStatus("Admin session cleared.");
  });

  if (!form) return;

  request("GET")
    .then((payload) => {
      if (payload.authenticated) window.location.assign(adminDestination());
      else if (payload.pending_mfa) setStatus("Restart sign-in to finish MFA verification.", true);
    })
    .catch(() => {});

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    if (!email || !password) {
      setStatus("Enter your admin email and password.", true);
      return;
    }
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    setStatus("Signing in...");
    try {
      const result = await request("POST", { action: "password", email, password });
      if (result.mfa_enrollment_required) {
        await beginEnrollment();
      } else if (result.mfa_required) {
        beginStepUp(result.factor_id);
      } else {
        window.location.assign(adminDestination());
      }
    } catch (error) {
      await clearSession();
      setStatus(error.message || "Could not sign in.", true);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
})();
