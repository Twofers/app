import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { logAiCost } from "../_shared/ai-costs.ts";
import {
  generateStructuredText,
  resolveAiTextProviderConfig,
  type AiTextProviderConfig,
  type ProviderAttempt,
} from "../_shared/ai-text-provider.ts";
import {
  AI_SITE_MENU_IMPORT_PROMPT_VERSION,
  buildSiteMenuPrompt,
  extractLogoCandidates,
  extractMenuLinks,
  htmlToMenuText,
  isPrivateOrReservedIp,
  MAX_HTML_BYTES,
  MAX_IMAGE_BYTES,
  MAX_LOGO_CANDIDATES,
  MAX_PDF_BYTES,
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  DAILY_SCAN_LIMIT_DEFAULT,
  menuSchema,
  normalizeMenuItems,
  validateImportUrl,
  type LogoCandidateSource,
  type MenuExtractionResult,
} from "../_shared/site-import.ts";

type JsonHeaders = Record<string, string>;

const USER_AGENT = "TwoferBot/1.0 (+https://www.twoferapp.com)";
const HTML_CONTENT_TYPE = /^(text\/html|application\/xhtml\+xml)/;
const IMAGE_CONTENT_TYPE = /^image\/(png|jpe?g|webp|gif)/;
const PDF_CONTENT_TYPE = /^application\/pdf/;
const MIN_MENU_TEXT_CHARS = 100;

function log(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ tag: "site_import", event, ...details }));
}

function jsonResponse(corsHeaders: JsonHeaders, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  corsHeaders: JsonHeaders,
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse(corsHeaders, status, { error: message, error_code: code });
}

// ---------------------------------------------------------------------------
// SSRF-safe fetch — every outbound request in this function goes through here.
// ---------------------------------------------------------------------------

type FetchOk = { ok: true; bytes: Uint8Array; contentType: string };
type FetchErr = { ok: false; code: string };

async function hostResolvesToPublicIp(
  host: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  let anyResolved = false;
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const ips = await Deno.resolveDns(host, recordType);
      for (const ip of ips) {
        anyResolved = true;
        if (isPrivateOrReservedIp(ip)) return { ok: false, code: "BLOCKED_URL" };
      }
    } catch {
      // A host legitimately may lack one record type (e.g. no AAAA). Ignore.
    }
  }
  if (!anyResolved) return { ok: false, code: "FETCH_FAILED" };
  return { ok: true };
}

async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const reader = res.body?.getReader();
  if (!reader) return { ok: true, bytes: new Uint8Array(0) };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, bytes };
}

async function safeFetch(params: {
  url: string;
  accept: string;
  allowedContentType: RegExp;
  maxBytes: number;
  overflowCode: string;
}): Promise<FetchOk | FetchErr> {
  let currentUrl = params.url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const parsed = validateImportUrl(currentUrl);
    if (!parsed.ok) {
      const blocked = parsed.code === "IP_LITERAL" || parsed.code === "BLOCKED_HOST";
      return { ok: false, code: blocked ? "BLOCKED_URL" : "INVALID_URL" };
    }

    const hostCheck = await hostResolvesToPublicIp(parsed.url.hostname);
    if (!hostCheck.ok) return { ok: false, code: hostCheck.code };

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT, Accept: params.accept },
      });
    } catch {
      return { ok: false, code: "FETCH_FAILED" };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      if (!location) return { ok: false, code: "FETCH_FAILED" };
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, code: "FETCH_FAILED" };
      }
      continue; // re-validate URL syntax + DNS/IP on the redirect target
    }

    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: false, code: "FETCH_FAILED" };
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!params.allowedContentType.test(contentType)) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      return { ok: false, code: "CONTENT_TYPE" };
    }

    const streamed = await readCapped(res, params.maxBytes);
    if (!streamed.ok) return { ok: false, code: params.overflowCode };
    return { ok: true, bytes: streamed.bytes, contentType };
  }

  return { ok: false, code: "FETCH_FAILED" }; // exceeded redirect budget
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function baseMime(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

function extractTitle(html: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

// ---------------------------------------------------------------------------
// AI provider config (mirrors menuExtractionConfig() in ai-extract-menu)
// ---------------------------------------------------------------------------

function menuTextConfig(): AiTextProviderConfig {
  const base = resolveAiTextProviderConfig();
  return {
    ...base,
    routerEnabled: true,
    primaryProvider: "gemini",
    fallbackProvider: "openai",
    fallbackEnabled: true,
  };
}

/**
 * PDF menu extraction is pinned to Gemini only: the Gemini path passes
 * imageInputs[].mimeType through verbatim (verified in _shared/gemini-text-provider.ts
 * geminiUserParts), so it accepts application/pdf; the OpenAI structured-text path
 * does not. fallbackEnabled:false guarantees we never hand a PDF to OpenAI.
 */
function menuPdfConfigGeminiOnly(): AiTextProviderConfig {
  const base = resolveAiTextProviderConfig();
  return {
    ...base,
    routerEnabled: true,
    primaryProvider: "gemini",
    fallbackProvider: "openai",
    fallbackEnabled: false,
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse(corsHeaders, 405, "METHOD", "Method not allowed");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const dailyLimit = (() => {
    const raw = Number(Deno.env.get("SITE_IMPORT_DAILY_LIMIT"));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DAILY_SCAN_LIMIT_DEFAULT;
  })();

  const userClient = createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const admin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return errorResponse(corsHeaders, 401, "UNAUTHORIZED", "Unauthorized. Please log in.");
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse(corsHeaders, 400, "INVALID_URL", "Invalid JSON body.");
    }

    const websiteUrlRaw = typeof body.website_url === "string" ? body.website_url.trim() : "";
    const businessId = typeof body.business_id === "string" ? body.business_id.trim() : "";

    // Optional business ownership check (business row may not exist yet at onboarding).
    let bizCategory = "";
    if (businessId) {
      const { data: biz, error: bizErr } = await admin
        .from("businesses")
        .select("id,owner_id,category")
        .eq("id", businessId)
        .maybeSingle();
      if (bizErr || !biz || (biz as { owner_id?: string }).owner_id !== user.id) {
        return errorResponse(corsHeaders, 403, "FORBIDDEN", "Business not found or access denied.");
      }
      bizCategory = ((biz as { category?: string }).category ?? "").trim();
    }

    // Rate limit: count scans in the trailing 24h, then log this one (hostname only).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await admin
      .from("site_import_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);
    if (!countErr && typeof count === "number" && count >= dailyLimit) {
      log("rate_limited", { count });
      return errorResponse(
        corsHeaders,
        429,
        "RATE_LIMITED",
        "You've reached today's website-import limit. Try again tomorrow.",
      );
    }

    const validated = validateImportUrl(websiteUrlRaw);
    if (!validated.ok) {
      const blocked = validated.code === "IP_LITERAL" || validated.code === "BLOCKED_HOST";
      return errorResponse(
        corsHeaders,
        400,
        blocked ? "BLOCKED_URL" : "INVALID_URL",
        "That website address can't be imported.",
      );
    }
    const homepageUrl = validated.url.toString();
    const host = validated.url.hostname;

    // Log the scan event (count-then-insert has a benign race; acceptable here).
    await admin.from("site_import_events").insert({ user_id: user.id, website_host: host });

    log("scan_start", { host });

    // ----- Homepage fetch (the one hard dependency) -----
    const homepage = await safeFetch({
      url: homepageUrl,
      accept: "text/html,application/xhtml+xml",
      allowedContentType: HTML_CONTENT_TYPE,
      maxBytes: MAX_HTML_BYTES,
      overflowCode: "SITE_TOO_LARGE",
    });
    if (!homepage.ok) {
      const status =
        homepage.code === "BLOCKED_URL"
          ? 400
          : homepage.code === "SITE_TOO_LARGE"
            ? 413
            : 502;
      const code =
        homepage.code === "BLOCKED_URL" || homepage.code === "SITE_TOO_LARGE"
          ? homepage.code
          : "FETCH_FAILED";
      log("homepage_fetch_failed", { host, code });
      return errorResponse(corsHeaders, status, code, "We couldn't read that website.");
    }

    const homepageHtml = new TextDecoder("utf-8").decode(homepage.bytes);
    const siteTitle = extractTitle(homepageHtml);
    const warnings: string[] = [];

    // ----- Logo candidates (deterministic; no AI) -----
    const logoCandidates = extractLogoCandidates(homepageHtml, homepageUrl);
    const logos: Array<{
      data_uri: string;
      source: LogoCandidateSource;
      content_type: string;
      bytes: number;
    }> = [];
    for (const candidate of logoCandidates) {
      if (logos.length >= MAX_LOGO_CANDIDATES) break;
      const fetched = await safeFetch({
        url: candidate.url,
        accept: "image/png,image/jpeg,image/webp,image/gif",
        allowedContentType: IMAGE_CONTENT_TYPE,
        maxBytes: MAX_IMAGE_BYTES,
        overflowCode: "IMAGE_TOO_LARGE",
      });
      if (!fetched.ok) continue; // silently skip individual image failures
      const mime = baseMime(fetched.contentType);
      logos.push({
        data_uri: `data:${mime};base64,${base64FromBytes(fetched.bytes)}`,
        source: candidate.source,
        content_type: mime,
        bytes: fetched.bytes.length,
      });
    }
    if (logos.length === 0) warnings.push("LOGO_NOT_FOUND");

    // ----- Menu text discovery -----
    let menuText = "";
    let menuPageUrl: string | null = null;
    let menuPdfUrl: string | null = null;

    const menuLinks = extractMenuLinks(homepageHtml, homepageUrl);
    for (const link of menuLinks) {
      if (link.kind === "page") {
        if (menuText) continue;
        const page = await safeFetch({
          url: link.url,
          accept: "text/html,application/xhtml+xml",
          allowedContentType: HTML_CONTENT_TYPE,
          maxBytes: MAX_HTML_BYTES,
          overflowCode: "SITE_TOO_LARGE",
        });
        if (page.ok) {
          const text = htmlToMenuText(new TextDecoder("utf-8").decode(page.bytes));
          if (text.length >= MIN_MENU_TEXT_CHARS) {
            menuText = text;
            menuPageUrl = link.url;
          }
        }
      } else if (link.kind === "pdf" && !menuPdfUrl) {
        menuPdfUrl = link.url;
      }
    }

    // Single-page sites: fall back to the homepage's own text.
    if (!menuText) {
      const homepageText = htmlToMenuText(homepageHtml);
      if (homepageText.length >= MIN_MENU_TEXT_CHARS) menuText = homepageText;
    }

    // ----- Menu structuring (the single AI call) -----
    const aiConfigured = Boolean((openAiKey ?? "").trim()) || Boolean((geminiApiKey ?? "").trim());
    let menu: { items: unknown[]; low_legibility: boolean; menu_notes: string } | null = null;
    const requestGroupId = crypto.randomUUID();

    const logAttempts = async (attempts: readonly ProviderAttempt[]) => {
      for (const attempt of attempts) {
        await logAiCost(admin, {
          businessId: businessId || null,
          ownerUserId: user.id,
          requestGroupId,
          feature: "site_import",
          provider: attempt.provider,
          model: attempt.model,
          endpoint: attempt.provider === "gemini" ? "models.generateContent" : "chat.completions",
          openaiRequestId: attempt.provider === "openai" ? attempt.requestId ?? null : null,
          success: attempt.success,
          errorCode: attempt.errorCode ?? attempt.errorClass ?? undefined,
          errorMessage: attempt.errorClass ?? undefined,
          estimatedCostUsd: attempt.estimatedCostUsd,
        });
      }
    };

    if (menuText && aiConfigured) {
      try {
        const generation = await generateStructuredText<typeof menuSchema, MenuExtractionResult>(
          {
            operation: "merchant_context",
            systemPrompt:
              "Extract menu items from a local business's website text. Return only grounded JSON.",
            userPrompt: `${buildSiteMenuPrompt(bizCategory)}\n\nWEBSITE TEXT:\n${menuText}`,
            jsonSchema: menuSchema,
            maxOutputTokens: 1600,
            timeoutMs: 20_000,
            generationRunId: requestGroupId,
            promptVersion: AI_SITE_MENU_IMPORT_PROMPT_VERSION,
            reasoningLevel: "low",
          },
          { openAiApiKey: openAiKey, geminiApiKey, admin, config: menuTextConfig() },
        );
        await logAttempts(generation.attempts);
        menu = {
          items: normalizeMenuItems(generation.value),
          low_legibility: generation.value.low_legibility === true,
          menu_notes:
            typeof generation.value.menu_notes === "string" ? generation.value.menu_notes : "",
        };
      } catch (err) {
        await logAttempts((err as { attempts?: ProviderAttempt[] })?.attempts ?? []);
        log("menu_extraction_failed", {
          host,
          errorCode: (err as { errorCode?: string })?.errorCode ?? "AI_GENERATION_FAILED",
        });
        warnings.push("MENU_EXTRACTION_FAILED");
      }
    } else if (!menuText && menuPdfUrl && (geminiApiKey ?? "").trim()) {
      // Menu is a PDF and no readable page text — Gemini can read PDFs directly.
      const pdf = await safeFetch({
        url: menuPdfUrl,
        accept: "application/pdf",
        allowedContentType: PDF_CONTENT_TYPE,
        maxBytes: MAX_PDF_BYTES,
        overflowCode: "PDF_TOO_LARGE",
      });
      if (pdf.ok) {
        try {
          const generation = await generateStructuredText<typeof menuSchema, MenuExtractionResult>(
            {
              operation: "merchant_context",
              systemPrompt:
                "Extract menu items from a local business's menu PDF. Return only grounded JSON.",
              userPrompt: buildSiteMenuPrompt(bizCategory),
              jsonSchema: menuSchema,
              imageInputs: [{ bytes: pdf.bytes, mimeType: "application/pdf" }],
              maxOutputTokens: 1600,
              timeoutMs: 20_000,
              generationRunId: requestGroupId,
              promptVersion: AI_SITE_MENU_IMPORT_PROMPT_VERSION,
              reasoningLevel: "low",
            },
            { openAiApiKey: openAiKey, geminiApiKey, admin, config: menuPdfConfigGeminiOnly() },
          );
          await logAttempts(generation.attempts);
          menu = {
            items: normalizeMenuItems(generation.value),
            low_legibility: generation.value.low_legibility === true,
            menu_notes:
              typeof generation.value.menu_notes === "string" ? generation.value.menu_notes : "",
          };
        } catch (err) {
          await logAttempts((err as { attempts?: ProviderAttempt[] })?.attempts ?? []);
          log("menu_pdf_extraction_failed", { host });
          warnings.push("MENU_PDF_ONLY");
        }
      } else {
        warnings.push("MENU_PDF_ONLY");
      }
    }

    if (!menu) {
      if (menuPdfUrl && !warnings.includes("MENU_PDF_ONLY")) warnings.push("MENU_PDF_ONLY");
      else if (!warnings.includes("MENU_EXTRACTION_FAILED")) warnings.push("MENU_NOT_FOUND");
    } else if (Array.isArray(menu.items) && menu.items.length === 0) {
      warnings.push("MENU_EMPTY");
    }

    log("scan_done", {
      host,
      logos: logos.length,
      menu_items: menu?.items.length ?? 0,
      has_pdf: Boolean(menuPdfUrl),
    });

    return jsonResponse(corsHeaders, 200, {
      ok: true,
      logo_candidates: logos,
      menu,
      menu_page_url: menuPageUrl,
      menu_pdf_url: menuPdfUrl,
      site_title: siteTitle,
      warnings,
    });
  } catch {
    log("server_error", { errorCode: "SITE_IMPORT_SERVER_ERROR" });
    return errorResponse(corsHeaders, 500, "SERVER", "Server error.");
  }
});
