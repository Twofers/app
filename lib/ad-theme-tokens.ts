export type AdThemeId =
  | "light_neutral"
  | "dark_neutral"
  | "warm_local"
  | "cool_clean"
  | "high_contrast";

export type AdThemeTokens = {
  id: AdThemeId;
  cardBackground: string;
  panelBackground: string;
  panelText: string;
  panelMutedText: string;
  imageScrimTop: string;
  imageScrimBottom: string;
  badgeBackground: string;
  badgeText: string;
  ctaBackground: string;
  ctaText: string;
  border: string;
  fallbackGradient: [string, string];
};

export const AD_THEME_IDS: readonly AdThemeId[] = [
  "light_neutral",
  "dark_neutral",
  "warm_local",
  "cool_clean",
  "high_contrast",
] as const;

const THEMES: Record<AdThemeId, AdThemeTokens> = {
  light_neutral: {
    id: "light_neutral",
    cardBackground: "#FFFFFF",
    panelBackground: "rgba(255,255,255,0.94)",
    panelText: "#111827",
    panelMutedText: "#4B5563",
    imageScrimTop: "rgba(0,0,0,0.02)",
    imageScrimBottom: "rgba(0,0,0,0.62)",
    badgeBackground: "rgba(17,24,39,0.82)",
    badgeText: "#FFFFFF",
    ctaBackground: "#FF9F1C",
    ctaText: "#11181C",
    border: "#E5E7EB",
    fallbackGradient: ["#F9FAFB", "#FFE6BF"],
  },
  dark_neutral: {
    id: "dark_neutral",
    cardBackground: "#151718",
    panelBackground: "rgba(27,30,32,0.94)",
    panelText: "#ECEDEE",
    panelMutedText: "#B4BCC5",
    imageScrimTop: "rgba(0,0,0,0.08)",
    imageScrimBottom: "rgba(0,0,0,0.76)",
    badgeBackground: "rgba(255,255,255,0.16)",
    badgeText: "#FFFFFF",
    ctaBackground: "#FF9F1C",
    ctaText: "#11181C",
    border: "#2A2F33",
    fallbackGradient: ["#202427", "#4B3721"],
  },
  warm_local: {
    id: "warm_local",
    cardBackground: "#FFFFFF",
    panelBackground: "rgba(255,250,244,0.95)",
    panelText: "#1F2937",
    panelMutedText: "#5F4337",
    imageScrimTop: "rgba(0,0,0,0.02)",
    imageScrimBottom: "rgba(55,35,20,0.66)",
    badgeBackground: "rgba(124,45,18,0.9)",
    badgeText: "#FFFFFF",
    ctaBackground: "#FF9F1C",
    ctaText: "#11181C",
    border: "#E7D8CB",
    fallbackGradient: ["#FFF7ED", "#F3D6B6"],
  },
  cool_clean: {
    id: "cool_clean",
    cardBackground: "#FFFFFF",
    panelBackground: "rgba(245,250,252,0.96)",
    panelText: "#10202B",
    panelMutedText: "#465A67",
    imageScrimTop: "rgba(0,0,0,0.01)",
    imageScrimBottom: "rgba(16,32,43,0.64)",
    badgeBackground: "rgba(16,32,43,0.88)",
    badgeText: "#FFFFFF",
    ctaBackground: "#FF9F1C",
    ctaText: "#11181C",
    border: "#D8E4EA",
    fallbackGradient: ["#F4FAFC", "#DCEEF4"],
  },
  high_contrast: {
    id: "high_contrast",
    cardBackground: "#000000",
    panelBackground: "#000000",
    panelText: "#FFFFFF",
    panelMutedText: "#E5E7EB",
    imageScrimTop: "rgba(0,0,0,0.12)",
    imageScrimBottom: "rgba(0,0,0,0.86)",
    badgeBackground: "#FFFFFF",
    badgeText: "#000000",
    ctaBackground: "#FFB454",
    ctaText: "#000000",
    border: "#FFFFFF",
    fallbackGradient: ["#000000", "#374151"],
  },
};

export function resolveAdThemeTokens(themeId: string | null | undefined): AdThemeTokens {
  return THEMES[themeId as AdThemeId] ?? THEMES.light_neutral;
}
