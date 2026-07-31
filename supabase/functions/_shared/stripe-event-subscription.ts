function stripeReferenceId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  const id = (value as { id?: unknown } | null)?.id;
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed || null;
}

/**
 * Stripe Basil/Dahlia moved an invoice's subscription reference from the
 * legacy top-level `subscription` field to
 * `parent.subscription_details.subscription`. Accept both shapes so webhook
 * delivery order cannot make a valid trial look unsubscribed.
 */
export function stripeSubscriptionIdFromEventObject(value: unknown): string | null {
  const object = value as {
    subscription?: unknown;
    parent?: {
      type?: unknown;
      subscription_details?: { subscription?: unknown } | null;
    } | null;
  } | null;

  const legacy = stripeReferenceId(object?.subscription);
  if (legacy) return legacy;
  if (object?.parent?.type !== "subscription_details") return null;
  return stripeReferenceId(object.parent.subscription_details?.subscription);
}
