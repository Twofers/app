import { secureDeleteItem, secureGetItem, secureSetItem } from "./redemption-secure-store";

const WALLET_CLAIM_TOKEN_PREFIX = "twofer:wallet-claim-token:";

function claimTokenKey(claimId: string) {
  return `${WALLET_CLAIM_TOKEN_PREFIX}${claimId}`;
}

export async function getWalletClaimToken(claimId: string): Promise<string | null> {
  if (!claimId) return null;
  const token = await secureGetItem(claimTokenKey(claimId));
  return token && token.trim().length > 0 ? token : null;
}

export async function saveWalletClaimToken(claimId: string | null | undefined, token: string | null | undefined) {
  if (!claimId || !token || token.trim().length === 0) return;
  await secureSetItem(claimTokenKey(claimId), token);
}

export async function clearWalletClaimToken(claimId: string | null | undefined) {
  if (!claimId) return;
  await secureDeleteItem(claimTokenKey(claimId));
}
