import { Share } from "react-native";
import * as Crypto from "expo-crypto";
import type { TFunction } from "i18next";
import { supabase } from "./supabase";
import { isShareDealEnabled } from "./runtime-env";

const RAW_SHARE_BASE = process.env.EXPO_PUBLIC_SHARE_BASE_URL?.trim() || "https://www.twoferapp.com/s";
const SHARE_BASE = RAW_SHARE_BASE.replace(/\/+$/, "");

// Excludes 0, O, I, L, and 1 to avoid hand-typing confusion.
const SHARE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SHARE_CODE_LENGTH = 7;
const MAX_INSERT_RETRIES = 4;

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

function randomShareCode(length = SHARE_CODE_LENGTH): string {
  // CSPRNG (Math.random is guessable). Same alphabet/length as before so
  // existing codes stay valid. Modulo bias over a 31-char alphabet is
  // negligible and matches the server short-code generator's idiom.
  const bytes = Crypto.getRandomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SHARE_ALPHABET[bytes[i]! % SHARE_ALPHABET.length];
  }
  return out;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as SupabaseErrorLike | null)?.code === "23505";
}

function errorMessage(error: unknown): string {
  return (error as SupabaseErrorLike | null)?.message || "Could not create share link";
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data.user?.id) throw new Error("You need to be signed in to share a deal.");
  return data.user.id;
}

async function findExistingShareCode(dealId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("deal_shares")
    .select("share_code")
    .eq("deal_id", dealId)
    .eq("shared_by_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.share_code === "string" && data.share_code.length > 0 ? data.share_code : null;
}

export function buildShareUrl(shareCode: string): string {
  return `${SHARE_BASE}/${encodeURIComponent(shareCode)}`;
}

export async function getOrCreateShareCode(dealId: string): Promise<string> {
  if (!isShareDealEnabled()) {
    throw new Error("Share Deal is not enabled.");
  }
  const userId = await currentUserId();
  const existing = await findExistingShareCode(dealId, userId);
  if (existing) return existing;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt += 1) {
    const candidate = randomShareCode();
    const { data, error } = await supabase
      .from("deal_shares")
      .insert({
        share_code: candidate,
        deal_id: dealId,
        shared_by_user_id: userId,
      })
      .select("share_code")
      .single();

    if (!error && typeof data?.share_code === "string" && data.share_code.length > 0) {
      return data.share_code;
    }

    lastError = error;
    if (isUniqueViolation(error)) {
      const afterConflict = await findExistingShareCode(dealId, userId);
      if (afterConflict) return afterConflict;
      continue;
    }

    throw new Error(errorMessage(error));
  }

  throw new Error(errorMessage(lastError));
}

export type ShareDealCopy = {
  shareUrl: string;
  message: string;
  title: string;
};

export function buildShareCopy(args: {
  shareCode: string;
  dealTitle: string;
  businessName: string;
  t: TFunction;
}): ShareDealCopy {
  const shareUrl = buildShareUrl(args.shareCode);
  const message = args.t("shareDeal.message", {
    defaultValue: "{{dealTitle}}\n\nLimited-time local offer available now at {{businessName}}.\n{{shareUrl}}",
    dealTitle: args.dealTitle,
    businessName: args.businessName,
    shareUrl,
  });
  const title = args.t("shareDeal.shareSheetTitle", {
    defaultValue: "{{dealTitle}}",
    dealTitle: args.dealTitle,
  });
  return { shareUrl, message, title };
}

export async function openShareSheet(copy: ShareDealCopy): Promise<boolean> {
  const result = await Share.share(
    { message: copy.message, url: copy.shareUrl, title: copy.title },
    { dialogTitle: copy.title, subject: copy.title },
  );
  return result.action !== Share.dismissedAction;
}
