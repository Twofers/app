(() => {
  const endpoint = document.body.dataset.activationStatusEndpoint;
  const status = document.querySelector("[data-activation-status]");
  const retry = document.querySelector("[data-activation-retry]");
  const sessionId = new URLSearchParams(window.location.search).get("session_id") || "";
  let attempts = 0;
  let state = "checking";

  const messages = {
    en: {
      checking: "Checking activation status…",
      missing: "Open the confirmation link from Stripe to check activation.",
      active: "Activation confirmed. Return to Twofer and refresh your business account.",
      retry: "This checkout did not activate your trial. Return to the app or your approval email to retry.",
      pending: "Stripe confirmation is still pending. This page will check again automatically.",
      error: "We couldn't check activation right now. Refresh this page or contact support.",
      retryLink: "Retry activation",
    },
    es: {
      checking: "Comprobando el estado de activación…",
      missing: "Abre el enlace de confirmación de Stripe para comprobar la activación.",
      active: "Activación confirmada. Vuelve a Twofer y actualiza tu cuenta de negocio.",
      retry: "Este checkout no activó tu prueba. Vuelve a la app o al correo de aprobación para intentarlo de nuevo.",
      pending: "La confirmación de Stripe sigue pendiente. Esta página volverá a comprobarla automáticamente.",
      error: "No pudimos comprobar la activación ahora. Actualiza esta página o contacta con soporte.",
      retryLink: "Reintentar activación",
    },
    ko: {
      checking: "활성화 상태를 확인하는 중…",
      missing: "Stripe 확인 링크를 열어 활성화 상태를 확인하세요.",
      active: "활성화가 확인되었습니다. Twofer로 돌아가 비즈니스 계정을 새로고침하세요.",
      retry: "이 결제로 체험판이 활성화되지 않았습니다. 앱 또는 승인 이메일로 돌아가 다시 시도하세요.",
      pending: "Stripe 확인이 아직 처리 중입니다. 이 페이지에서 자동으로 다시 확인합니다.",
      error: "현재 활성화 상태를 확인할 수 없습니다. 페이지를 새로고침하거나 지원팀에 문의하세요.",
      retryLink: "활성화 다시 시도",
    },
  };

  function locale() {
    const value = String(document.documentElement.lang || "en").toLowerCase();
    if (value.startsWith("es")) return "es";
    if (value.startsWith("ko")) return "ko";
    return "en";
  }

  function render() {
    const copy = messages[locale()];
    if (status) status.textContent = copy[state] || copy.checking;
    if (retry) retry.textContent = copy.retryLink;
  }

  function show(nextState) {
    state = nextState;
    render();
  }

  async function check() {
    if (!endpoint || !sessionId) {
      show("missing");
      return;
    }
    attempts += 1;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const payload = await response.json();
      if (payload.state === "active") {
        show("active");
        return;
      }
      if (payload.retry_allowed) {
        show("retry");
        if (retry) retry.hidden = false;
        return;
      }
      show("pending");
      if (attempts < 20) window.setTimeout(check, 3000);
    } catch {
      show("error");
      if (retry) retry.hidden = false;
    }
  }

  window.addEventListener("twofer:localechange", render);
  render();
  check();
})();
