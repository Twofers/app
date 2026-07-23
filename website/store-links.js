// Single place to drop in the real store URLs once they exist. A platform left
// null keeps its CTAs hidden so the site never shows fake download links.
// Both stores are live as of 2026-07-22.
window.TWOFER_STORE_LINKS = {
  ios: "https://apps.apple.com/us/app/twofer-local-deals-on-demand/id6765769303",
  android: "https://play.google.com/store/apps/details?id=com.unvmex2.twoforone",
};

(() => {
  const STRINGS = {
    en: {
      ios: { available: "Get Twofer for iPhone", badgeAlt: "Download on the App Store" },
      android: { available: "Get Twofer for Android", badgeAlt: "Get it on Google Play" },
    },
    es: {
      ios: { available: "Obtener Twofer para iPhone", badgeAlt: "Consíguelo en el App Store" },
      android: { available: "Obtener Twofer para Android", badgeAlt: "Disponible en Google Play" },
    },
    ko: {
      ios: { available: "iPhone용 Twofer 받기", badgeAlt: "App Store에서 다운로드" },
      android: { available: "Android용 Twofer 받기", badgeAlt: "Google Play에서 다운로드" },
    },
  };

  // Official badge artwork, downloaded unmodified from Apple's marketing
  // toolbox and Google Play's badge endpoint. Both brands require the images be
  // used as supplied -- do not recolor, crop, or redraw them.
  // Intrinsic sizes are declared so the browser reserves space before load.
  // Google's PNG bakes in its own clear space, which is why it is rendered
  // taller than Apple's to make the two read as the same visual height.
  const BADGES = {
    ios: {
      en: { src: "/assets/badge-appstore-en.svg", width: 120, height: 40 },
      es: { src: "/assets/badge-appstore-es.svg", width: 120, height: 40 },
      ko: { src: "/assets/badge-appstore-ko.svg", width: 130, height: 40 },
    },
    android: {
      en: { src: "/assets/badge-googleplay-en.png", width: 155, height: 60 },
      es: { src: "/assets/badge-googleplay-es.png", width: 155, height: 60 },
      ko: { src: "/assets/badge-googleplay-ko.png", width: 155, height: 60 },
    },
  };

  const FALLBACK_TEXT = {
    en: "Email me launch updates",
    es: "Avísenme cuando la app esté lista",
    ko: "앱 준비되면 알려주세요",
  };

  // Must match localization.js's STORAGE_KEY and its resolution order.
  const LOCALE_STORAGE_KEY = "twofer_site_locale";

  function normalize(value) {
    const raw = String(value || "").toLowerCase();
    if (raw.startsWith("es")) return "es";
    if (raw.startsWith("ko")) return "ko";
    return "";
  }

  // Resolved the same way localization.js resolves it, rather than by reading
  // documentElement.lang. On the homepage this script runs from <head> while
  // localization.js is at the end of <body>, so at first paint lang is still
  // the static "en" and the badges rendered in English before swapping on the
  // locale-change event -- a visible flash for Spanish and Korean visitors,
  // and permanently wrong artwork if that later render never happened.
  function currentLocale() {
    try {
      const stored = normalize(window.localStorage.getItem(LOCALE_STORAGE_KEY));
      if (stored) return stored;
    } catch {
      // Local storage can be disabled in private browsing.
    }
    const browserLocale = Array.isArray(navigator.languages) ? navigator.languages[0] : navigator.language;
    return normalize(browserLocale) || normalize(document.documentElement.lang) || "en";
  }

  // Which store button to show first. iPadOS 13+ reports a Macintosh UA, so
  // touch support is used to tell an iPad apart from a desktop Mac. Anything
  // we cannot identify (desktop, bots) falls through to iOS-first.
  function preferredPlatform() {
    const ua = navigator.userAgent || "";
    if (/android/i.test(ua)) return "android";
    if (/iphone|ipad|ipod/i.test(ua)) return "ios";
    if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";
    return "ios";
  }

  function renderBadge(node, platform, locale, strings) {
    const badge = BADGES[platform] && (BADGES[platform][locale] || BADGES[platform].en);
    if (!badge) return false;

    let img = node.querySelector("img[data-store-badge-img]");
    if (!img) {
      img = document.createElement("img");
      img.setAttribute("data-store-badge-img", "");
      node.textContent = "";
      node.appendChild(img);
    }
    img.className = `store-badge store-badge--${platform === "ios" ? "apple" : "google"}`;
    img.src = badge.src;
    img.width = badge.width;
    img.height = badge.height;
    img.alt = strings.badgeAlt;
    // Eager, not lazy: these are 5-12 KB and usually the primary above-the-fold
    // action. Lazy-loading them delays the main CTA for no meaningful saving.
    img.loading = "eager";
    img.decoding = "async";
    return true;
  }

  // Put the visitor's own platform first without disturbing the non-store
  // buttons that share these rows (e.g. "Request Business Access"): the
  // preferred badge is moved ahead of whichever store CTA currently leads.
  function orderByPlatform(preferred) {
    const containers = new Set();
    document.querySelectorAll("[data-store-cta]").forEach((node) => {
      if (node.parentElement) containers.add(node.parentElement);
    });

    containers.forEach((container) => {
      const ctas = [...container.querySelectorAll(":scope > [data-store-cta]")].filter((n) => !n.hidden);
      if (ctas.length < 2) return;
      const first = ctas[0];
      const wanted = ctas.find((n) => n.getAttribute("data-store-cta") === preferred);
      if (wanted && wanted !== first) container.insertBefore(wanted, first);
    });
  }

  function render() {
    const locale = currentLocale();
    let anyLinkReady = false;

    document.querySelectorAll("[data-store-cta]").forEach((node) => {
      const platform = node.getAttribute("data-store-cta");
      const strings = STRINGS[locale] && STRINGS[locale][platform];
      if (!strings) return;

      const link = window.TWOFER_STORE_LINKS && window.TWOFER_STORE_LINKS[platform];
      const wantsBadge = node.hasAttribute("data-store-badge");

      if (wantsBadge && link) {
        node.setAttribute("aria-label", strings.badgeAlt);
        if (!renderBadge(node, platform, locale, strings)) node.textContent = strings.available;
      } else {
        node.removeAttribute("aria-label");
        node.textContent = strings.available;
      }

      if (link) {
        anyLinkReady = true;
        node.hidden = false;
        node.dataset.storeReady = "true";
        node.removeAttribute("aria-hidden");
        node.removeAttribute("tabindex");
        node.href = link;
        node.target = "_blank";
        node.rel = "noopener";
        return;
      }

      node.hidden = true;
      delete node.dataset.storeReady;
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("tabindex", "-1");
      node.removeAttribute("href");
      node.removeAttribute("target");
      node.removeAttribute("rel");
    });

    if (anyLinkReady) orderByPlatform(preferredPlatform());

    // If neither store link is live yet, every data-store-cta button on the
    // page is hidden. Without this, a section built around "get the app"
    // (e.g. the customer feature grid) would show no working action at all.
    document.querySelectorAll("[data-store-fallback]").forEach((node) => {
      node.hidden = anyLinkReady;
      node.textContent = FALLBACK_TEXT[locale] || FALLBACK_TEXT.en;
    });

    // The launch-signup email forms (launch-signup.js) follow the same rule:
    // visible only while no store link is live.
    document.querySelectorAll("[data-store-fallback-note], [data-launch-signup]").forEach((node) => {
      node.hidden = anyLinkReady;
    });
  }

  function boot() {
    render();
    document.querySelectorAll("[data-language-option]").forEach((node) => {
      node.addEventListener("click", () => window.setTimeout(render, 0));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener("twofer:localechange", render);
})();
