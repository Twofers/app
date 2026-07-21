import { useMemo, useState } from "react";
import {
  ImageBackground,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Outfit_900Black, useFonts } from "@expo-google-fonts/outfit";
import { BlackHanSans_400Regular } from "@expo-google-fonts/black-han-sans";

import { Radii } from "@/constants/theme";
import {
  assertPosterCopyPolicy,
  sanitizePosterCopy,
} from "@/lib/poster/posterPolicy";
import { posterCopyForLocale } from "@/lib/poster/posterAdSpec";
import type { PosterCopyV1, PosterSpecV1, PosterTemplateId } from "@/lib/poster/posterTypes";
import { isPosterLookV2Enabled, isPosterViewerLanguageEnabled } from "@/lib/runtime-env";
import type { SupportedLocale } from "@/lib/supported-locales";
import { POSTER_TEMPLATES, posterTemplateOrDefault } from "./posterTemplates";

export const POSTER_CANVAS_WIDTH = 1080;
export const POSTER_CANVAS_HEIGHT = 1350;
const POSTER_EDGE_X = 72;
const POSTER_COPY_WIDTH = POSTER_CANVAS_WIDTH - POSTER_EDGE_X * 2;
const POSTER_TOP_BAND_HEIGHT = 330;
const POSTER_BOTTOM_BAND_TOP = 888;
const POSTER_BUSINESS_TEXT_SIZE = 34;
const POSTER_BUSINESS_LINE_HEIGHT = 42;
const POSTER_EYEBROW_TEXT_SIZE = 42;
const POSTER_EYEBROW_LINE_HEIGHT = 50;
const POSTER_HERO_TEXT_SIZE = 72;
const POSTER_HERO_LINE_HEIGHT = 80;
const POSTER_OFFER_TEXT_SIZE = 58;
const POSTER_OFFER_LINE_HEIGHT = 66;
const POSTER_SCHEDULE_TEXT_SIZE = 28;
const POSTER_SCHEDULE_LINE_HEIGHT = 34;

// Poster Look v2 (flag-gated). V1 constants and components above are untouched.
const POSTER_V2_LATIN_FONT_FAMILY = "Outfit_900Black";
const POSTER_V2_KOREAN_FONT_FAMILY = "BlackHanSans_400Regular";
const POSTER_V2_BADGE_TEXT_COLOR = "#221507";
const POSTER_V2_BUSINESS_TEXT_SIZE = 30;
const POSTER_V2_BUSINESS_LINE_HEIGHT = 36;
const POSTER_V2_BUSINESS_LETTER_SPACING = 3;
const POSTER_V2_EYEBROW_TEXT_SIZE = 36;
const POSTER_V2_EYEBROW_LINE_HEIGHT = 42;
const POSTER_V2_HERO_TEXT_SIZE = 84;
const POSTER_V2_HERO_LINE_HEIGHT = 90;
const POSTER_V2_BADGE_TEXT_SIZE = 56;
const POSTER_V2_BADGE_LINE_HEIGHT = 62;
const POSTER_V2_OFFER_LINE_TEXT_SIZE = 50;
const POSTER_V2_OFFER_LINE_LINE_HEIGHT = 58;
const POSTER_V2_SCHEDULE_TEXT_SIZE = 26;
const POSTER_V2_SCHEDULE_LINE_HEIGHT = 32;

// Luminance-aware legibility over photos. The template text colors (e.g. `fresh`'s
// dark teal) are tuned for the template's light no-image gradient; over a photo
// they can drop to ~1:1 contrast (headline invisible on dark subjects like coffee
// or brisket). When an image is present we render the copy in light ink and darken
// the top band by an amount scaled to the image's own top-band luminance
// (`spec.luma.top`, 0..1, computed where the pixels are accessible). The bottom
// band already carries a heavy offer scrim, so it only needs the light ink.
const POSTER_ON_IMAGE_HEADLINE = "#FFFFFF"; // headline + offer-secondary (hero copy)
const POSTER_ON_IMAGE_MUTED = "#EFEAE1"; // business name + schedule (soft warm white)
const POSTER_SCRIM_TARGET_LUMA = 0.2; // effective top-band luminance we want behind light ink
// Used when the spec carries no measured luminance (e.g. posters generated before the
// server computes it). Sized to keep light ink ≥3:1 even over a near-white top band
// (~0.88 luma → 0.88*(1-0.66)=0.30 effective); slightly over-darkens already-dark tops,
// which is safe. Posters that do carry spec.luma get an optimally-sized scrim instead.
const POSTER_TOP_SCRIM_FALLBACK = 0.66;

/** Top-band black-scrim alpha needed to bring image luminance `l` (0..1) down to the target. */
function topScrimAlphaForLuma(l: number | null | undefined): number {
  if (l == null || !Number.isFinite(l)) return POSTER_TOP_SCRIM_FALLBACK;
  const needed = l > POSTER_SCRIM_TARGET_LUMA ? 1 - POSTER_SCRIM_TARGET_LUMA / l : 0;
  return Math.min(0.85, Math.max(0, needed));
}

/** Optional per-band luminance the renderer consumes for the adaptive scrim. */
type PosterBandLuma = { top?: number | null; bottom?: number | null } | null | undefined;
function readPosterLuma(spec: PosterSpecV1 | null | undefined): PosterBandLuma {
  const raw = (spec as unknown as { luma?: PosterBandLuma })?.luma;
  return raw && typeof raw === "object" ? raw : null;
}

export type AdPosterCanvasProps = {
  spec?: PosterSpecV1 | null;
  copy?: PosterCopyV1 | null;
  templateId?: PosterTemplateId | null;
  imageUri?: string | null;
  liveScheduleLabel?: string | null;
  eyebrowLabel?: string | null;
  /** Viewer's app language. Only used to pick poster copy when the poster viewer-language flag is on. */
  contentLocale?: SupportedLocale | null;
  /**
   * Dev/gallery override for the Look v2 render path. Undefined in production, so
   * shipped surfaces always resolve the look from the runtime flag. Only the
   * __DEV__ poster gallery sets this, to render V1 and V2 side-by-side without a
   * Metro restart. Does not change production behavior.
   */
  forceLookV2?: boolean;
  style?: StyleProp<ViewStyle>;
};

function useScaled(width: number) {
  return useMemo(() => {
    const ratio = width > 0 ? width / POSTER_CANVAS_WIDTH : 1;
    return (value: number) => Math.round(value * ratio);
  }, [width]);
}

function cleanText(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function posterText(value: string | null | undefined): string {
  return cleanText(value).toLocaleUpperCase();
}

// F-024 (2026-07-08, deterministic enforcement of the prompt's own rule): the
// generation prompt forbids generic poster kickers ("Try our", "Our deal",
// "Special offer", "Menu pick"), but nothing enforced it when the model emitted
// one anyway — stacked above a quantifier headline it renders as the
// ungrammatical "TRY OUR / ANY MUFFIN...". Blank exactly those documented
// generic defaults at render time so both the owner preview and already-stored
// consumer poster specs never show them. Values are compared after posterText
// uppercasing; anything else passes through untouched.
const GENERIC_POSTER_KICKERS = new Set(["TRY OUR", "OUR DEAL", "SPECIAL OFFER", "MENU PICK"]);

function sanitizedPosterEyebrow(value: string): string {
  return GENERIC_POSTER_KICKERS.has(value.trim()) ? "" : value;
}

function PosterLine({
  value,
  top,
  left,
  width,
  size,
  lineHeight,
  color,
  lines = 1,
  weight = "900",
  scale,
}: {
  value: string;
  top: number;
  left: number;
  width: number;
  size: number;
  lineHeight: number;
  color: string;
  lines?: number;
  weight?: "700" | "800" | "900";
  scale: (value: number) => number;
}) {
  return (
    <Text
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={0.58}
      maxFontSizeMultiplier={1}
      style={{
        position: "absolute",
        left: scale(left),
        top: scale(top),
        width: scale(width),
        color,
        fontSize: scale(size),
        lineHeight: scale(lineHeight),
        fontWeight: weight,
        textAlign: "center",
        letterSpacing: 0,
        textShadowColor: "rgba(0,0,0,0.56)",
        textShadowOffset: { width: 0, height: scale(3) },
        textShadowRadius: scale(12),
        zIndex: 6,
      }}
    >
      {value}
    </Text>
  );
}

function PosterBackground({
  imageUri,
  templateId,
  topScrim = 0,
}: {
  imageUri?: string | null;
  templateId: PosterTemplateId;
  topScrim?: number;
}) {
  const theme = POSTER_TEMPLATES[templateId];

  return (
    <>
      {imageUri ? (
        <ImageBackground source={{ uri: imageUri }} resizeMode="cover" style={StyleSheet.absoluteFillObject} />
      ) : (
        <LinearGradient
          colors={theme.background}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {topScrim > 0 ? (
        // Luminance-aware top-band scrim so light headline/business copy always
        // clears contrast, sized to the image's own top-band brightness.
        <LinearGradient
          colors={[
            `rgba(0,0,0,${topScrim.toFixed(3)})`,
            `rgba(0,0,0,${(topScrim * 0.5).toFixed(3)})`,
            "rgba(0,0,0,0.00)",
          ]}
          locations={[0, 0.16, 0.3]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {templateId === "fresh" ? (
        <>
          <LinearGradient
            colors={["rgba(4,84,86,0.42)", "rgba(4,84,86,0.08)", "rgba(246,196,69,0.18)"]}
            locations={[0, 0.63, 1]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : null}
      {templateId === "bold" ? (
        <>
          <View style={[styles.splitOverlay, styles.splitOverlayLeft]} />
          <View style={[styles.splitOverlay, styles.splitOverlayRight]} />
        </>
      ) : null}
      {templateId === "premium" ? (
        <LinearGradient
          colors={[
            "rgba(0,0,0,0.92)",
            "rgba(0,0,0,0.66)",
            "rgba(0,0,0,0.18)",
            "rgba(0,0,0,0.00)",
            "rgba(0,0,0,0.12)",
            "rgba(0,0,0,0.82)",
            "rgba(0,0,0,0.98)",
          ]}
          locations={[0, 0.13, 0.29, 0.52, 0.65, 0.82, 1]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </>
  );
}

function TopCopyBlock({
  copy,
  eyebrowLabel,
  templateId,
  onImage,
  scale,
}: {
  copy: PosterCopyV1;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  onImage: boolean;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const heroLine = posterText(copy.headline || copy.offer_line_2);
  const eyebrow = sanitizedPosterEyebrow(posterText(copy.subline || eyebrowLabel));
  const businessColor = onImage ? POSTER_ON_IMAGE_MUTED : theme.business;
  const headlineColor = onImage ? POSTER_ON_IMAGE_HEADLINE : theme.headline;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: scale(POSTER_TOP_BAND_HEIGHT),
        alignItems: "center",
        zIndex: 9,
      }}
    >
      <PosterLine
        value={copy.business_name}
        top={28}
        left={POSTER_EDGE_X}
        width={POSTER_COPY_WIDTH}
        size={POSTER_BUSINESS_TEXT_SIZE}
        lineHeight={POSTER_BUSINESS_LINE_HEIGHT}
        color={businessColor}
        scale={scale}
      />
      {eyebrow ? (
        <PosterLine
          value={eyebrow}
          top={86}
          left={POSTER_EDGE_X}
          width={POSTER_COPY_WIDTH}
          size={POSTER_EYEBROW_TEXT_SIZE}
          lineHeight={POSTER_EYEBROW_LINE_HEIGHT}
          color={theme.accent}
          scale={scale}
        />
      ) : null}
      <PosterLine
        value={heroLine}
        top={148}
        left={POSTER_EDGE_X}
        width={POSTER_COPY_WIDTH}
        size={POSTER_HERO_TEXT_SIZE}
        lineHeight={POSTER_HERO_LINE_HEIGHT}
        color={headlineColor}
        lines={2}
        scale={scale}
      />
    </View>
  );
}

function OfferBlock({
  copy,
  liveScheduleLabel,
  templateId,
  onImage,
  scale,
}: {
  copy: PosterCopyV1;
  liveScheduleLabel?: string | null;
  templateId: PosterTemplateId;
  onImage: boolean;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const primaryLine = posterText(copy.offer_line_1);
  const secondaryLine = posterText(copy.offer_line_2 || copy.headline);
  const scheduleLine = posterText(liveScheduleLabel);
  const secondaryColor = onImage ? POSTER_ON_IMAGE_HEADLINE : theme.headline;
  const scheduleColor = onImage ? POSTER_ON_IMAGE_MUTED : theme.subline;

  return (
    <>
      <LinearGradient
        colors={["rgba(0,0,0,0.00)", "rgba(0,0,0,0.70)", "rgba(0,0,0,0.98)"]}
        locations={[0, 0.26, 1]}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: scale(POSTER_BOTTOM_BAND_TOP),
          bottom: 0,
          zIndex: 4,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: scale(POSTER_EDGE_X),
          top: scale(1036),
          width: scale(POSTER_COPY_WIDTH),
          minHeight: scale(230),
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9,
        }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.56}
          maxFontSizeMultiplier={1}
          style={{
            width: "100%",
            color: theme.accent,
            fontSize: scale(POSTER_OFFER_TEXT_SIZE),
            lineHeight: scale(POSTER_OFFER_LINE_HEIGHT),
            fontWeight: "900",
            textAlign: "center",
            letterSpacing: 0,
            textShadowColor: "rgba(0,0,0,0.62)",
            textShadowOffset: { width: 0, height: scale(3) },
            textShadowRadius: scale(12),
          }}
        >
          {primaryLine}
        </Text>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.56}
          maxFontSizeMultiplier={1}
          style={{
            width: "100%",
            marginTop: scale(28),
            color: secondaryColor,
            fontSize: scale(POSTER_OFFER_TEXT_SIZE),
            lineHeight: scale(POSTER_OFFER_LINE_HEIGHT),
            fontWeight: "900",
            textAlign: "center",
            letterSpacing: 0,
            textShadowColor: "rgba(0,0,0,0.62)",
            textShadowOffset: { width: 0, height: scale(3) },
            textShadowRadius: scale(12),
          }}
        >
          {secondaryLine}
        </Text>
      </View>
      {scheduleLine ? (
        <PosterLine
          value={scheduleLine}
          top={1290}
          left={POSTER_EDGE_X}
          width={POSTER_COPY_WIDTH}
          size={POSTER_SCHEDULE_TEXT_SIZE}
          lineHeight={POSTER_SCHEDULE_LINE_HEIGHT}
          color={scheduleColor}
          scale={scale}
        />
      ) : null}
    </>
  );
}

function PosterContent({
  copy,
  imageUri,
  liveScheduleLabel,
  eyebrowLabel,
  templateId,
  onImage,
  topScrim,
  scale,
}: {
  copy: PosterCopyV1;
  imageUri?: string | null;
  liveScheduleLabel?: string | null;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  onImage: boolean;
  topScrim: number;
  scale: (value: number) => number;
}) {
  return (
    <>
      <PosterBackground imageUri={imageUri} templateId={templateId} topScrim={topScrim} />
      <TopCopyBlock copy={copy} eyebrowLabel={eyebrowLabel} templateId={templateId} onImage={onImage} scale={scale} />
      <OfferBlock copy={copy} liveScheduleLabel={liveScheduleLabel} templateId={templateId} onImage={onImage} scale={scale} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Poster Look v2 (flag-gated render path). Sibling of PosterContent above;
// the V1 components and constants are untouched when the flag is off.
// ---------------------------------------------------------------------------

function PosterLineV2({
  value,
  top,
  left,
  width,
  size,
  lineHeight,
  color,
  lines = 1,
  letterSpacing = 0,
  fontFamily,
  scale,
}: {
  value: string;
  top: number;
  left: number;
  width: number;
  size: number;
  lineHeight: number;
  color: string;
  lines?: number;
  letterSpacing?: number;
  fontFamily?: string;
  scale: (value: number) => number;
}) {
  return (
    <Text
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={0.58}
      maxFontSizeMultiplier={1}
      style={{
        position: "absolute",
        left: scale(left),
        top: scale(top),
        width: scale(width),
        color,
        fontSize: scale(size),
        lineHeight: scale(lineHeight),
        fontWeight: "900",
        fontFamily,
        textAlign: "center",
        letterSpacing,
        textShadowColor: "rgba(0,0,0,0.35)",
        textShadowOffset: { width: 0, height: scale(2) },
        textShadowRadius: scale(6),
        zIndex: 6,
      }}
    >
      {value}
    </Text>
  );
}

function TopCopyBlockV2({
  copy,
  eyebrowLabel,
  templateId,
  fontFamily,
  onImage,
  scale,
}: {
  copy: PosterCopyV1;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  fontFamily?: string;
  onImage: boolean;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const heroLine = posterText(copy.headline || copy.offer_line_2);
  const eyebrow = sanitizedPosterEyebrow(posterText(copy.subline || eyebrowLabel));
  const businessColor = onImage ? POSTER_ON_IMAGE_MUTED : theme.business;
  const headlineColor = onImage ? POSTER_ON_IMAGE_HEADLINE : theme.headline;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: scale(POSTER_TOP_BAND_HEIGHT),
        alignItems: "center",
        zIndex: 9,
      }}
    >
      <PosterLineV2
        value={copy.business_name}
        top={44}
        left={POSTER_EDGE_X}
        width={POSTER_COPY_WIDTH}
        size={POSTER_V2_BUSINESS_TEXT_SIZE}
        lineHeight={POSTER_V2_BUSINESS_LINE_HEIGHT}
        color={businessColor}
        letterSpacing={POSTER_V2_BUSINESS_LETTER_SPACING}
        fontFamily={fontFamily}
        scale={scale}
      />
      {eyebrow ? (
        <PosterLineV2
          value={eyebrow}
          top={92}
          left={POSTER_EDGE_X}
          width={POSTER_COPY_WIDTH}
          size={POSTER_V2_EYEBROW_TEXT_SIZE}
          lineHeight={POSTER_V2_EYEBROW_LINE_HEIGHT}
          color={theme.accent}
          fontFamily={fontFamily}
          scale={scale}
        />
      ) : null}
      <PosterLineV2
        value={heroLine}
        top={148}
        left={POSTER_EDGE_X}
        width={POSTER_COPY_WIDTH}
        size={POSTER_V2_HERO_TEXT_SIZE}
        lineHeight={POSTER_V2_HERO_LINE_HEIGHT}
        color={headlineColor}
        lines={2}
        fontFamily={fontFamily}
        scale={scale}
      />
    </View>
  );
}

function OfferBlockV2({
  copy,
  liveScheduleLabel,
  templateId,
  fontFamily,
  onImage,
  scale,
}: {
  copy: PosterCopyV1;
  liveScheduleLabel?: string | null;
  templateId: PosterTemplateId;
  fontFamily?: string;
  onImage: boolean;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const primaryLine = posterText(copy.offer_line_1);
  const secondaryLine = posterText(copy.offer_line_2 || copy.headline);
  const scheduleLine = posterText(liveScheduleLabel);
  const secondaryColor = onImage ? POSTER_ON_IMAGE_HEADLINE : theme.headline;
  const scheduleColor = onImage ? POSTER_ON_IMAGE_MUTED : theme.subline;

  return (
    <>
      <LinearGradient
        colors={["rgba(0,0,0,0.00)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.86)"]}
        locations={[0, 0.38, 1]}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: scale(POSTER_BOTTOM_BAND_TOP),
          bottom: 0,
          zIndex: 4,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: scale(POSTER_EDGE_X),
          top: scale(1036),
          width: scale(POSTER_COPY_WIDTH),
          minHeight: scale(230),
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9,
        }}
      >
        <View
          style={{
            backgroundColor: theme.accent,
            borderRadius: 999,
            paddingHorizontal: scale(44),
            paddingVertical: scale(16),
          }}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            maxFontSizeMultiplier={1}
            style={{
              color: POSTER_V2_BADGE_TEXT_COLOR,
              fontSize: scale(POSTER_V2_BADGE_TEXT_SIZE),
              lineHeight: scale(POSTER_V2_BADGE_LINE_HEIGHT),
              fontWeight: "900",
              fontFamily,
              textAlign: "center",
            }}
          >
            {primaryLine}
          </Text>
        </View>
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.56}
          maxFontSizeMultiplier={1}
          style={{
            width: "100%",
            marginTop: scale(24),
            color: secondaryColor,
            fontSize: scale(POSTER_V2_OFFER_LINE_TEXT_SIZE),
            lineHeight: scale(POSTER_V2_OFFER_LINE_LINE_HEIGHT),
            fontWeight: "900",
            fontFamily,
            textAlign: "center",
            textShadowColor: "rgba(0,0,0,0.35)",
            textShadowOffset: { width: 0, height: scale(2) },
            textShadowRadius: scale(6),
          }}
        >
          {secondaryLine}
        </Text>
      </View>
      {scheduleLine ? (
        <PosterLineV2
          value={scheduleLine}
          top={1290}
          left={POSTER_EDGE_X}
          width={POSTER_COPY_WIDTH}
          size={POSTER_V2_SCHEDULE_TEXT_SIZE}
          lineHeight={POSTER_V2_SCHEDULE_LINE_HEIGHT}
          color={scheduleColor}
          fontFamily={fontFamily}
          scale={scale}
        />
      ) : null}
    </>
  );
}

function PosterContentV2({
  copy,
  imageUri,
  liveScheduleLabel,
  eyebrowLabel,
  templateId,
  fontFamily,
  onImage,
  topScrim,
  scale,
}: {
  copy: PosterCopyV1;
  imageUri?: string | null;
  liveScheduleLabel?: string | null;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  fontFamily?: string;
  onImage: boolean;
  topScrim: number;
  scale: (value: number) => number;
}) {
  return (
    <>
      <PosterBackground imageUri={imageUri} templateId={templateId} topScrim={topScrim} />
      <TopCopyBlockV2 copy={copy} eyebrowLabel={eyebrowLabel} templateId={templateId} fontFamily={fontFamily} onImage={onImage} scale={scale} />
      <OfferBlockV2 copy={copy} liveScheduleLabel={liveScheduleLabel} templateId={templateId} fontFamily={fontFamily} onImage={onImage} scale={scale} />
    </>
  );
}

export function posterCopyFromSpec(spec: PosterSpecV1 | null | undefined): PosterCopyV1 | null {
  if (!spec?.enabled) return null;
  return spec.copy_by_language["en-US"] ?? Object.values(spec.copy_by_language)[0] ?? null;
}

/** Locale-aware variant of `posterCopyFromSpec`, used only when the poster viewer-language flag is on. */
function posterCopyFromSpecForLocale(
  spec: PosterSpecV1 | null | undefined,
  locale: SupportedLocale | null | undefined,
): PosterCopyV1 | null {
  if (!spec?.enabled) return null;
  if (!locale) return posterCopyFromSpec(spec);
  return posterCopyForLocale(spec, locale) ?? posterCopyFromSpec(spec);
}

export function AdPosterCanvas({
  spec,
  copy,
  templateId,
  imageUri,
  liveScheduleLabel,
  eyebrowLabel,
  contentLocale,
  forceLookV2,
  style,
}: AdPosterCanvasProps) {
  const [width, setWidth] = useState(0);
  const scale = useScaled(width);
  const height = width > 0 ? Math.round((width * POSTER_CANVAS_HEIGHT) / POSTER_CANVAS_WIDTH) : undefined;
  const rawCopy =
    copy ??
    (isPosterViewerLanguageEnabled()
      ? posterCopyFromSpecForLocale(spec, contentLocale)
      : posterCopyFromSpec(spec));
  const resolvedTemplate = posterTemplateOrDefault(templateId ?? spec?.template_id);
  const lookV2Enabled = forceLookV2 ?? isPosterLookV2Enabled();
  const onImage = Boolean(imageUri);
  const topScrim = onImage ? topScrimAlphaForLuma(readPosterLuma(spec)?.top) : 0;
  // Fonts load in the background; until then (or if loading ever fails) fontsLoaded stays
  // false and the poster keeps rendering with the system font — it must never render blank.
  const [fontsLoaded] = useFonts({ Outfit_900Black, BlackHanSans_400Regular });
  const displayFontFamily =
    lookV2Enabled && fontsLoaded
      ? contentLocale === "ko-KR"
        ? POSTER_V2_KOREAN_FONT_FAMILY
        : POSTER_V2_LATIN_FONT_FAMILY
      : undefined;
  const sanitized = useMemo(() => {
    if (!rawCopy) return null;
    return sanitizePosterCopy(rawCopy, rawCopy.business_name || "Local Favorite").copy;
  }, [rawCopy]);
  const policy = sanitized ? assertPosterCopyPolicy(sanitized) : null;
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  if (!sanitized || policy?.passed !== true) {
    return null;
  }

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.canvas,
        {
          height,
          backgroundColor: POSTER_TEMPLATES[resolvedTemplate].background[0],
        },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel={`${sanitized.business_name} poster. ${sanitized.offer_line_1}. ${sanitized.headline}.`}
    >
      {lookV2Enabled ? (
        <PosterContentV2
          copy={sanitized}
          imageUri={imageUri}
          liveScheduleLabel={liveScheduleLabel}
          eyebrowLabel={eyebrowLabel}
          templateId={resolvedTemplate}
          fontFamily={displayFontFamily}
          onImage={onImage}
          topScrim={topScrim}
          scale={scale}
        />
      ) : (
        <PosterContent
          copy={sanitized}
          imageUri={imageUri}
          liveScheduleLabel={liveScheduleLabel}
          eyebrowLabel={eyebrowLabel}
          templateId={resolvedTemplate}
          onImage={onImage}
          topScrim={topScrim}
          scale={scale}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: "100%",
    aspectRatio: POSTER_CANVAS_WIDTH / POSTER_CANVAS_HEIGHT,
    position: "relative",
    borderRadius: Radii.md,
    overflow: "hidden",
  },
  splitOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "50%",
  },
  splitOverlayLeft: {
    left: 0,
    backgroundColor: "rgba(49,16,67,0.70)",
  },
  splitOverlayRight: {
    right: 0,
    backgroundColor: "rgba(244,122,0,0.56)",
  },
});
