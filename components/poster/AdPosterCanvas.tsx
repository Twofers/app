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

export type AdPosterCanvasProps = {
  spec?: PosterSpecV1 | null;
  copy?: PosterCopyV1 | null;
  templateId?: PosterTemplateId | null;
  imageUri?: string | null;
  liveScheduleLabel?: string | null;
  eyebrowLabel?: string | null;
  /** Viewer's app language. Only used to pick poster copy when the poster viewer-language flag is on. */
  contentLocale?: SupportedLocale | null;
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
}: {
  imageUri?: string | null;
  templateId: PosterTemplateId;
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
  scale,
}: {
  copy: PosterCopyV1;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const heroLine = posterText(copy.headline || copy.offer_line_2);
  const eyebrow = posterText(copy.subline || eyebrowLabel);

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
        color={theme.business}
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
        color={theme.headline}
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
  scale,
}: {
  copy: PosterCopyV1;
  liveScheduleLabel?: string | null;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const primaryLine = posterText(copy.offer_line_1);
  const secondaryLine = posterText(copy.offer_line_2 || copy.headline);
  const scheduleLine = posterText(liveScheduleLabel);

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
            color: theme.headline,
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
          color={theme.subline}
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
  scale,
}: {
  copy: PosterCopyV1;
  imageUri?: string | null;
  liveScheduleLabel?: string | null;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  return (
    <>
      <PosterBackground imageUri={imageUri} templateId={templateId} />
      <TopCopyBlock copy={copy} eyebrowLabel={eyebrowLabel} templateId={templateId} scale={scale} />
      <OfferBlock copy={copy} liveScheduleLabel={liveScheduleLabel} templateId={templateId} scale={scale} />
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
  scale,
}: {
  copy: PosterCopyV1;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  fontFamily?: string;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const heroLine = posterText(copy.headline || copy.offer_line_2);
  const eyebrow = posterText(copy.subline || eyebrowLabel);

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
      <LinearGradient
        colors={["rgba(0,0,0,0.60)", "rgba(0,0,0,0.34)", "rgba(0,0,0,0.00)"]}
        locations={[0, 0.14, 0.30]}
        style={StyleSheet.absoluteFill}
      />
      <PosterLineV2
        value={copy.business_name}
        top={44}
        left={POSTER_EDGE_X}
        width={POSTER_COPY_WIDTH}
        size={POSTER_V2_BUSINESS_TEXT_SIZE}
        lineHeight={POSTER_V2_BUSINESS_LINE_HEIGHT}
        color={theme.business}
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
        color={theme.headline}
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
  scale,
}: {
  copy: PosterCopyV1;
  liveScheduleLabel?: string | null;
  templateId: PosterTemplateId;
  fontFamily?: string;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const primaryLine = posterText(copy.offer_line_1);
  const secondaryLine = posterText(copy.offer_line_2 || copy.headline);
  const scheduleLine = posterText(liveScheduleLabel);

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
            color: theme.headline,
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
          color={theme.subline}
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
  scale,
}: {
  copy: PosterCopyV1;
  imageUri?: string | null;
  liveScheduleLabel?: string | null;
  eyebrowLabel?: string | null;
  templateId: PosterTemplateId;
  fontFamily?: string;
  scale: (value: number) => number;
}) {
  return (
    <>
      <PosterBackground imageUri={imageUri} templateId={templateId} />
      <TopCopyBlockV2 copy={copy} eyebrowLabel={eyebrowLabel} templateId={templateId} fontFamily={fontFamily} scale={scale} />
      <OfferBlockV2 copy={copy} liveScheduleLabel={liveScheduleLabel} templateId={templateId} fontFamily={fontFamily} scale={scale} />
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
  const lookV2Enabled = isPosterLookV2Enabled();
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
          scale={scale}
        />
      ) : (
        <PosterContent
          copy={sanitized}
          imageUri={imageUri}
          liveScheduleLabel={liveScheduleLabel}
          eyebrowLabel={eyebrowLabel}
          templateId={resolvedTemplate}
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
