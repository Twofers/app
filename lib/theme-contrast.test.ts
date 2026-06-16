import { describe, expect, it } from "vitest";

import { Colors } from "../constants/theme-colors";

const REQUIRED_COLOR_TOKENS = [
  "background",
  "surface",
  "surfaceElevated",
  "textPrimary",
  "textSecondary",
  "textMuted",
  "textInverse",
  "border",
  "divider",
  "accent",
  "accentText",
  "success",
  "successText",
  "warning",
  "warningText",
  "danger",
  "dangerText",
  "disabledBackground",
  "disabledText",
  "inputBackground",
  "inputText",
  "inputPlaceholder",
  "overlay",
  "qrContainerBackground",
] as const;

type Scheme = keyof typeof Colors;
type Theme = (typeof Colors)[Scheme];

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const normalized = raw.length === 3
    ? raw.split("").map((char) => `${char}${char}`).join("")
    : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected a 6-digit hex color, got ${hex}`);
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function channelLuminance(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const [red, green, blue] = hexToRgb(hex);
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

function contrastRatio(foreground: string, background: string) {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe("theme colors", () => {
  it("exposes the semantic tokens needed for light and dark mode", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const token of REQUIRED_COLOR_TOKENS) {
        expect(Colors[scheme][token], `${scheme}.${token}`).toEqual(expect.any(String));
        expect(Colors[scheme][token].length, `${scheme}.${token}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps key foreground and background pairs readable", () => {
    const pairs: {
      foreground: keyof Theme;
      background: keyof Theme;
      min: number;
    }[] = [
      { foreground: "textPrimary", background: "background", min: 4.5 },
      { foreground: "textPrimary", background: "surface", min: 4.5 },
      { foreground: "textSecondary", background: "background", min: 4.5 },
      { foreground: "textMuted", background: "background", min: 4.5 },
      { foreground: "accentText", background: "background", min: 4.5 },
      { foreground: "accentText", background: "surface", min: 4.5 },
      { foreground: "danger", background: "background", min: 4.5 },
      { foreground: "success", background: "background", min: 4.5 },
      { foreground: "inputText", background: "inputBackground", min: 4.5 },
      { foreground: "inputPlaceholder", background: "inputBackground", min: 4.5 },
      { foreground: "primaryText", background: "primary", min: 4.5 },
    ];

    for (const scheme of ["light", "dark"] as const) {
      for (const pair of pairs) {
        const foreground = Colors[scheme][pair.foreground];
        const background = Colors[scheme][pair.background];
        expect(
          contrastRatio(foreground, background),
          `${scheme}.${String(pair.foreground)} on ${String(pair.background)}`,
        ).toBeGreaterThanOrEqual(pair.min);
      }
    }
  });
});
