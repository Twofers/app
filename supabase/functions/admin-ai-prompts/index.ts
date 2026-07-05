import {
  audit,
  cleanString,
  json,
  readPayload,
  requireAdmin,
  UUID_RE,
} from "../_shared/admin-prospects.ts";
import { ADMIN_AI_PROMPT_VERSIONS, type AdminAiFeature } from "../_shared/admin-ai.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const FEATURES = new Set<AdminAiFeature>([
  "prospect_enrichment",
  "prospect_scoring",
  "demand_proof",
  "sales_script",
  "onboarding_review",
  "claim_link_assistant",
  "trial_conversion_assistant",
  "operating_report",
]);

function isFeature(value: string): value is AdminAiFeature {
  return FEATURES.has(value as AdminAiFeature);
}

function cleanPromptVersion(value: unknown, feature: AdminAiFeature): string {
  const cleaned = cleanString(value, 120);
  if (/^[a-z0-9][a-z0-9._-]{2,119}$/i.test(cleaned)) return cleaned;
  return ADMIN_AI_PROMPT_VERSIONS[feature];
}

function parseOutputSchema(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("OUTPUT_SCHEMA_MUST_BE_OBJECT");
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    throw new Error("OUTPUT_SCHEMA_MUST_BE_OBJECT");
  }
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error("OUTPUT_SCHEMA_MUST_BE_OBJECT");
}

function validateSystemPrompt(value: unknown): string {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (prompt.length < 80) throw new Error("SYSTEM_PROMPT_TOO_SHORT");
  if (prompt.length > 12000) throw new Error("SYSTEM_PROMPT_TOO_LONG");
  if (/sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{20,}|service_role\s*[:=]\s*[A-Za-z0-9._-]{20,}|raw_token\s*[:=]/i.test(prompt)) {
    throw new Error("SYSTEM_PROMPT_UNSAFE_SECRET_VALUE");
  }
  return prompt;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const requestId = crypto.randomUUID();

  try {
    const ctx = await requireAdmin(req, requestId, "prompt.manage");
    if (ctx instanceof Response) return ctx;
    const payload = req.method === "GET" ? {} : await readPayload(req);
    const action = cleanString(payload.action, 40) || "list";

    if (action === "list") {
      const { data, error } = await ctx.supabaseAdmin
        .from("admin_ai_prompts")
        .select("id,prompt_name,feature,prompt_version,system_prompt,output_schema,is_active,created_at,updated_at,last_used_at,created_by,updated_by")
        .order("feature", { ascending: true })
        .order("is_active", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return json(req, {
        ok: true,
        request_id: requestId,
        prompts: data ?? [],
        defaults: ADMIN_AI_PROMPT_VERSIONS,
      });
    }

    if (action === "upsert") {
      const feature = cleanString(payload.feature, 80);
      if (!isFeature(feature)) return json(req, { error: "Invalid prompt feature.", request_id: requestId }, 400);
      const promptName = cleanString(payload.prompt_name, 120) || feature;
      const promptVersion = cleanPromptVersion(payload.prompt_version, feature);
      const systemPrompt = validateSystemPrompt(payload.system_prompt);
      const outputSchema = parseOutputSchema(payload.output_schema);
      const makeActive = payload.is_active === true;

      if (makeActive) {
        const { error: deactivateError } = await ctx.supabaseAdmin
          .from("admin_ai_prompts")
          .update({ is_active: false, updated_by: ctx.user.id })
          .eq("feature", feature);
        if (deactivateError) throw deactivateError;
      }

      const { data, error } = await ctx.supabaseAdmin
        .from("admin_ai_prompts")
        .upsert({
          prompt_name: promptName,
          feature,
          prompt_version: promptVersion,
          system_prompt: systemPrompt,
          output_schema: outputSchema,
          is_active: makeActive,
          created_by: ctx.user.id,
          updated_by: ctx.user.id,
        }, { onConflict: "prompt_name,prompt_version" })
        .select("id,prompt_name,feature,prompt_version,is_active,updated_at")
        .single();
      if (error) throw error;

      await audit(ctx, {
        action: "admin_ai_prompt_saved",
        targetType: "admin_ai_prompt",
        targetId: data.id,
        afterValue: data,
        reason: makeActive ? "saved_and_activated" : "saved_inactive_version",
      });

      return json(req, { ok: true, request_id: requestId, prompt: data });
    }

    if (action === "activate") {
      const promptId = cleanString(payload.prompt_id, 80);
      if (!UUID_RE.test(promptId)) return json(req, { error: "Invalid prompt id.", request_id: requestId }, 400);

      const { data: prompt, error: promptError } = await ctx.supabaseAdmin
        .from("admin_ai_prompts")
        .select("id,feature,prompt_name,prompt_version")
        .eq("id", promptId)
        .maybeSingle();
      if (promptError) throw promptError;
      if (!prompt?.id || !isFeature(prompt.feature)) return json(req, { error: "Prompt not found.", request_id: requestId }, 404);

      const { error: deactivateError } = await ctx.supabaseAdmin
        .from("admin_ai_prompts")
        .update({ is_active: false, updated_by: ctx.user.id })
        .eq("feature", prompt.feature);
      if (deactivateError) throw deactivateError;

      const { data, error } = await ctx.supabaseAdmin
        .from("admin_ai_prompts")
        .update({ is_active: true, updated_by: ctx.user.id })
        .eq("id", promptId)
        .select("id,prompt_name,feature,prompt_version,is_active,updated_at")
        .single();
      if (error) throw error;

      await audit(ctx, {
        action: "admin_ai_prompt_activated",
        targetType: "admin_ai_prompt",
        targetId: promptId,
        afterValue: data,
        reason: "activate_prompt_version",
      });

      return json(req, { ok: true, request_id: requestId, prompt: data });
    }

    if (action === "deactivate") {
      const promptId = cleanString(payload.prompt_id, 80);
      if (!UUID_RE.test(promptId)) return json(req, { error: "Invalid prompt id.", request_id: requestId }, 400);
      const { data, error } = await ctx.supabaseAdmin
        .from("admin_ai_prompts")
        .update({ is_active: false, updated_by: ctx.user.id })
        .eq("id", promptId)
        .select("id,prompt_name,feature,prompt_version,is_active,updated_at")
        .single();
      if (error) throw error;

      await audit(ctx, {
        action: "admin_ai_prompt_deactivated",
        targetType: "admin_ai_prompt",
        targetId: promptId,
        afterValue: data,
        reason: "deactivate_prompt_version",
      });

      return json(req, { ok: true, request_id: requestId, prompt: data });
    }

    return json(req, { error: "Unknown prompt action.", request_id: requestId }, 400);
  } catch (error) {
    const code = String((error as Error)?.message ?? "");
    if (code === "SYSTEM_PROMPT_TOO_SHORT") {
      return json(req, { error: "System prompt is too short to save safely.", request_id: requestId }, 400);
    }
    if (code === "SYSTEM_PROMPT_TOO_LONG") {
      return json(req, { error: "System prompt is too long.", request_id: requestId }, 400);
    }
    if (code === "SYSTEM_PROMPT_UNSAFE_SECRET_VALUE") {
      return json(req, { error: "Prompt text cannot include API-key-looking values, service-role values, JWTs, or raw token assignments.", request_id: requestId }, 400);
    }
    if (code === "OUTPUT_SCHEMA_MUST_BE_OBJECT") {
      return json(req, { error: "Output schema must be a JSON object.", request_id: requestId }, 400);
    }
    console.error("[admin-ai-prompts] error:", error);
    return json(req, { error: "Failed to update admin AI prompts.", request_id: requestId }, 500);
  }
});
