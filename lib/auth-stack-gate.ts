const PUBLIC_ROOTS = new Set([
  "index",
  "auth-landing",
  "auth-callback",
  "forgot-password",
  "reset-password",
]);

export function shouldBypassAuthStackGate({ root, isDev }: { root: string; isDev: boolean }) {
  if (PUBLIC_ROOTS.has(root)) return true;
  if (isDev && root === "debug-diagnostics") return true;
  return false;
}

export function buildNextFromRoute({
  segments,
  params,
}: {
  segments: string[];
  params: Record<string, string | string[] | undefined>;
}) {
  const nextPath = "/" + segments.filter(Boolean).join("/");
  const nextQuery = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) => {
      if (typeof v === "string") return [[k, v]];
      if (Array.isArray(v)) return v.map((x) => [k, x]);
      return [];
    }),
  ).toString();
  const next = nextQuery.length > 0 ? `${nextPath}?${nextQuery}` : nextPath;
  return next === "" ? "/" : next;
}
