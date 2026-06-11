type AuthUserLike = {
  app_metadata?: Record<string, unknown> | null;
} | null | undefined;

export function isRedeemerUser(user: AuthUserLike): boolean {
  return user?.app_metadata?.app_role === "redeemer";
}

export function forbiddenForRedeemerResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: "This staff session can only redeem deals.", error_code: "REDEEMER_FORBIDDEN" }),
    {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
