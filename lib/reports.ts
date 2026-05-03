import { supabase } from "./supabase";

export type BusinessReportReason =
  | "not_honored"
  | "doesnt_exist"
  | "wrong_info"
  | "inappropriate"
  | "other";

export type UserReportReason =
  | "abusive"
  | "fraud"
  | "no_show"
  | "inappropriate"
  | "other";

export const BUSINESS_REPORT_REASONS: BusinessReportReason[] = [
  "not_honored",
  "doesnt_exist",
  "wrong_info",
  "inappropriate",
  "other",
];

export const USER_REPORT_REASONS: UserReportReason[] = [
  "abusive",
  "fraud",
  "no_show",
  "inappropriate",
  "other",
];

type SubmitOk = { ok: true; reportId: string };
type SubmitErr = { ok: false; reason: "unauthenticated" | "not_authorized" | "not_found" | "network" };

function classify(error: { message?: string } | null): SubmitErr["reason"] {
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("not authenticated")) return "unauthenticated";
  if (msg.includes("not authorized")) return "not_authorized";
  if (msg.includes("not found")) return "not_found";
  return "network";
}

export async function submitBusinessReport(args: {
  businessId: string;
  reason: BusinessReportReason;
  comment?: string;
  dealId?: string;
}): Promise<SubmitOk | SubmitErr> {
  const { data, error } = await supabase.rpc("report_business", {
    target_business_id: args.businessId,
    report_reason: args.reason,
    report_comment: args.comment ?? null,
    related_deal_id: args.dealId ?? null,
  });
  if (error || !data) return { ok: false, reason: classify(error) };
  return { ok: true, reportId: data as string };
}

export async function submitUserReport(args: {
  claimId: string;
  reason: UserReportReason;
  comment?: string;
}): Promise<SubmitOk | SubmitErr> {
  const { data, error } = await supabase.rpc("report_user", {
    related_claim_id: args.claimId,
    report_reason: args.reason,
    report_comment: args.comment ?? null,
  });
  if (error || !data) return { ok: false, reason: classify(error) };
  return { ok: true, reportId: data as string };
}
