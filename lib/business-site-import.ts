import { supabase } from "./supabase";
import { devWarn } from "./dev-log";
import { EDGE_FN_TIMEOUT_DEFAULT_MS } from "../constants/timing";

/**
 * Client wrapper for the `import-business-website` edge function (WI-4).
 *
 * Mirrors the defensive discipline of `lib/business-lookup.ts` /
 * `lib/functions.ts` (never throw on shape drift; unknown fields become
 * empty/null). We intentionally do NOT import from the locked `lib/functions.ts`
 * — this module is self-contained.
 */

export type SiteImportLogoCandidate = {
  data_uri: string;
  source: string;
  content_type: string;
  bytes: number;
};

export type SiteImportMenuItem = {
  name: string;
  category?: string;
  price_text?: string;
  size_options: string[];
  readable: boolean;
};

export type SiteImportMenu = {
  items: SiteImportMenuItem[];
  low_legibility: boolean;
  menu_notes: string;
};

export type SiteImportResult = {
  ok: boolean;
  logo_candidates: SiteImportLogoCandidate[];
  menu: SiteImportMenu | null;
  menu_page_url: string | null;
  menu_pdf_url: string | null;
  site_title: string;
  warnings: string[];
};

/** Thrown when the scan fails outright (network, SSRF block, rate limit, server). */
export class SiteImportError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SiteImportError";
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseLogoCandidates(value: unknown): SiteImportLogoCandidate[] {
  if (!Array.isArray(value)) return [];
  const out: SiteImportLogoCandidate[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    const dataUri = cleanString(row?.data_uri);
    if (!row || !dataUri.startsWith("data:image/")) continue;
    out.push({
      data_uri: dataUri,
      source: cleanString(row.source) || "unknown",
      content_type: cleanString(row.content_type) || "image/png",
      bytes: typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : 0,
    });
  }
  return out;
}

function parseMenuItems(value: unknown): SiteImportMenuItem[] {
  if (!Array.isArray(value)) return [];
  const out: SiteImportMenuItem[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    const name = cleanString(row?.name).trim();
    if (!row || !name) continue;
    const category = cleanString(row.category).trim();
    const priceText = cleanString(row.price_text).trim();
    out.push({
      name,
      category: category || undefined,
      price_text: priceText || undefined,
      size_options: Array.isArray(row.size_options)
        ? row.size_options
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .map((s) => s.trim())
        : [],
      readable: true,
    });
  }
  return out;
}

function parseMenu(value: unknown): SiteImportMenu | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    items: parseMenuItems(row.items),
    low_legibility: row.low_legibility === true,
    menu_notes: cleanString(row.menu_notes),
  };
}

function parseResult(data: unknown): SiteImportResult {
  const row = asRecord(data);
  return {
    ok: row?.ok === true,
    logo_candidates: parseLogoCandidates(row?.logo_candidates),
    menu: parseMenu(row?.menu),
    menu_page_url: stringOrNull(row?.menu_page_url),
    menu_pdf_url: stringOrNull(row?.menu_pdf_url),
    site_title: cleanString(row?.site_title),
    warnings: Array.isArray(row?.warnings)
      ? row!.warnings.filter((w): w is string => typeof w === "string")
      : [],
  };
}

/** Extract `{ error, error_code }` from a supabase functions.invoke error object. */
function shapeInvokeError(error: unknown): SiteImportError {
  let code = "SERVER";
  let message = "We couldn't read your website.";
  const e = error as { message?: string; context?: { body?: unknown } } | null;

  const body = asRecord(e?.context?.body);
  if (body) {
    if (typeof body.error_code === "string" && body.error_code) code = body.error_code;
    if (typeof body.error === "string" && body.error) message = body.error;
    return new SiteImportError(message, code);
  }

  if (typeof e?.message === "string") {
    try {
      const parsed = JSON.parse(e.message) as { error?: unknown; error_code?: unknown };
      if (typeof parsed.error_code === "string" && parsed.error_code) code = parsed.error_code;
      if (typeof parsed.error === "string" && parsed.error) message = parsed.error;
    } catch {
      // Non-JSON message — keep the generic fallback.
    }
  }
  return new SiteImportError(message, code);
}

/**
 * Fetch the business's own website server-side and return logo candidates and
 * structured menu items for one-tap confirmation at onboarding. Throws
 * `SiteImportError` (with a stable `.code`) on hard failure; a soft "nothing
 * found" is a successful result carrying `warnings` instead.
 */
export async function importBusinessWebsite(params: {
  website_url: string;
  business_id?: string;
}): Promise<SiteImportResult> {
  const body: Record<string, unknown> = { website_url: params.website_url };
  if (params.business_id) body.business_id = params.business_id;

  const { data, error } = await supabase.functions.invoke("import-business-website", {
    body,
    timeout: EDGE_FN_TIMEOUT_DEFAULT_MS,
  });

  if (error) {
    const shaped = shapeInvokeError(error);
    devWarn("[importBusinessWebsite] Edge function failed:", shaped.code);
    throw shaped;
  }
  if (data && typeof data === "object" && "error" in data) {
    const b = data as { error?: unknown; error_code?: unknown };
    throw new SiteImportError(
      typeof b.error === "string" ? b.error : "We couldn't read your website.",
      typeof b.error_code === "string" ? b.error_code : "SERVER",
    );
  }

  return parseResult(data);
}
