import type { PosterTemplateId } from "@/lib/poster/posterTypes";

export const POSTER_TEMPLATE_IDS: readonly PosterTemplateId[] = ["fresh", "bold", "premium"] as const;

export type PosterTemplateTheme = {
  id: PosterTemplateId;
  background: [string, string];
  imageTint: string;
  panel: string;
  panelText: string;
  headline: string;
  business: string;
  subline: string;
  accent: string;
  border: string;
};

export const POSTER_TEMPLATES: Record<PosterTemplateId, PosterTemplateTheme> = {
  fresh: {
    id: "fresh",
    background: ["#F8FFF7", "#D8F7EF"],
    imageTint: "rgba(255,255,255,0.10)",
    panel: "#0F766E",
    panelText: "#FFFFFF",
    headline: "#063D3A",
    business: "#0F3A37",
    subline: "#37635F",
    accent: "#F6C445",
    border: "rgba(15,118,110,0.22)",
  },
  bold: {
    id: "bold",
    background: ["#18181B", "#7C2D12"],
    imageTint: "rgba(0,0,0,0.10)",
    panel: "#FBBF24",
    panelText: "#111827",
    headline: "#FFFFFF",
    business: "#FFFFFF",
    subline: "#FDE68A",
    accent: "#22C55E",
    border: "rgba(255,255,255,0.24)",
  },
  premium: {
    id: "premium",
    background: ["#14100D", "#3D2A1F"],
    imageTint: "rgba(0,0,0,0.28)",
    panel: "rgba(255,244,214,0.94)",
    panelText: "#26160D",
    headline: "#FFF4DC",
    business: "#FFF9ED",
    subline: "#E7BE79",
    accent: "#D89A40",
    border: "rgba(255,244,214,0.26)",
  },
};

export function posterTemplateOrDefault(value: string | null | undefined): PosterTemplateId {
  return value === "bold" || value === "premium" || value === "fresh" ? value : "fresh";
}
