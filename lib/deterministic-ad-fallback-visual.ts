const FALLBACK_PALETTES = [
  {
    background: ["#173D3D", "#255E5A", "#F59E0B"] as const,
    markBackground: "rgba(255,255,255,0.92)",
    markText: "#173D3D",
    accent: "#FDE68A",
  },
  {
    background: ["#23313F", "#3E6B62", "#FF9F1C"] as const,
    markBackground: "rgba(255,255,255,0.92)",
    markText: "#23313F",
    accent: "#CFFAFE",
  },
  {
    background: ["#3B2F2F", "#58735A", "#F97316"] as const,
    markBackground: "rgba(255,255,255,0.92)",
    markText: "#3B2F2F",
    accent: "#DCFCE7",
  },
] as const;

export type DeterministicAdFallbackVisual = {
  initials: string;
  palette: (typeof FALLBACK_PALETTES)[number];
};

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function buildFallbackInitials(businessName: string | null | undefined): string {
  const words = (businessName ?? "").trim().match(/[A-Za-z0-9]+/g) ?? [];
  if (words.length === 0) return "2F";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

export function buildDeterministicAdFallbackVisual(params: {
  businessName?: string | null;
  headline?: string | null;
  offerLine?: string | null;
}): DeterministicAdFallbackVisual {
  const seed = [params.businessName, params.offerLine, params.headline]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("|");
  const palette = FALLBACK_PALETTES[hashText(seed || "twofer") % FALLBACK_PALETTES.length]!;
  return {
    initials: buildFallbackInitials(params.businessName),
    palette,
  };
}
