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

import { Radii } from "@/constants/theme";
import {
  assertPosterCopyPolicy,
  sanitizePosterCopy,
} from "@/lib/poster/posterPolicy";
import type { PosterCopyV1, PosterSpecV1, PosterTemplateId } from "@/lib/poster/posterTypes";
import { POSTER_TEMPLATES, posterTemplateOrDefault } from "./posterTemplates";

export const POSTER_CANVAS_WIDTH = 1080;
export const POSTER_CANVAS_HEIGHT = 1350;

export type AdPosterCanvasProps = {
  spec?: PosterSpecV1 | null;
  copy?: PosterCopyV1 | null;
  templateId?: PosterTemplateId | null;
  imageUri?: string | null;
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

function samePosterLine(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalize = (value: string | null | undefined) =>
    cleanText(value).toLocaleLowerCase().replace(/\s+/g, " ");
  const a = normalize(left);
  const b = normalize(right);
  return a.length > 0 && a === b;
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
            colors={["rgba(4,84,86,0.62)", "rgba(4,84,86,0.16)", "rgba(246,196,69,0.90)"]}
            locations={[0, 0.63, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.bottomBand, { backgroundColor: "rgba(248,255,247,0.90)" }]} />
        </>
      ) : null}
      {templateId === "bold" ? (
        <>
          <View style={[styles.splitOverlay, styles.splitOverlayLeft]} />
          <View style={[styles.splitOverlay, styles.splitOverlayRight]} />
          <View style={[styles.bottomBand, { backgroundColor: "rgba(10,10,14,0.84)" }]} />
        </>
      ) : null}
      {templateId === "premium" ? (
        <LinearGradient
          colors={["rgba(0,0,0,0.88)", "rgba(0,0,0,0.42)", "rgba(0,0,0,0.10)", "rgba(0,0,0,0.82)"]}
          locations={[0, 0.24, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </>
  );
}

function TopCopyBlock({
  copy,
  templateId,
  scale,
}: {
  copy: PosterCopyV1;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  return (
    <View
      style={{
        position: "absolute",
        top: scale(24),
        left: scale(72),
        width: scale(936),
        height: scale(54),
        alignItems: "center",
        zIndex: 9,
      }}
    >
      <PosterLine
        value={copy.business_name}
        top={0}
        left={0}
        width={936}
        size={40}
        lineHeight={46}
        color={theme.business}
        scale={scale}
      />
    </View>
  );
}

function OfferBlock({
  copy,
  templateId,
  scale,
}: {
  copy: PosterCopyV1;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const itemLine = cleanText(copy.headline) || cleanText(copy.offer_line_2);
  const supportLine = samePosterLine(itemLine, copy.offer_line_2) ? "" : cleanText(copy.offer_line_2);
  const isPremium = templateId === "premium";
  const badgeTop = isPremium ? (supportLine ? 884 : 918) : 760;
  const badgeLeft = isPremium ? 318 : 72;
  const badgeWidth = isPremium ? 444 : 372;
  const badgeRadius = isPremium ? 24 : 34;
  const headlineTop = isPremium ? (supportLine ? 1030 : 1074) : supportLine ? 1060 : 1094;
  const headlineSize = isPremium ? 74 : 82;
  const headlineLineHeight = isPremium ? 82 : 90;
  const badgeTextColor = templateId === "fresh" ? "#063D3A" : "#111827";

  return (
    <>
      {isPremium ? (
        <View
          style={{
            position: "absolute",
            left: scale(54),
            top: scale(850),
            width: scale(972),
            height: scale(430),
            borderRadius: scale(42),
            backgroundColor: "rgba(0,0,0,0.42)",
            borderWidth: scale(1),
            borderColor: "rgba(255,244,214,0.22)",
            zIndex: 7,
          }}
        />
      ) : null}
      <View
        style={{
          position: "absolute",
          left: scale(badgeLeft),
          top: scale(badgeTop),
          width: scale(badgeWidth),
          minHeight: scale(132),
          borderRadius: scale(badgeRadius),
          backgroundColor: theme.accent,
          borderWidth: scale(5),
          borderColor: templateId === "fresh" ? "rgba(6,61,58,0.18)" : "rgba(255,255,255,0.72)",
          justifyContent: "center",
          alignItems: "center",
          paddingHorizontal: scale(28),
          paddingVertical: scale(16),
          shadowColor: "#000000",
          shadowOpacity: 0.24,
          shadowRadius: scale(18),
          shadowOffset: { width: 0, height: scale(10) },
          transform: isPremium ? [] : [{ rotate: "-3deg" }],
          zIndex: 9,
        }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.52}
          maxFontSizeMultiplier={1}
          style={{
            width: "100%",
            color: badgeTextColor,
            fontSize: scale(60),
            lineHeight: scale(68),
            fontWeight: "900",
            textAlign: "center",
            letterSpacing: 0,
          }}
        >
          {copy.offer_line_1}
        </Text>
      </View>
      <View
        style={{
          position: "absolute",
          left: scale(72),
          top: scale(headlineTop),
          width: scale(936),
          minHeight: scale(150),
          justifyContent: "center",
          alignItems: "center",
          zIndex: 8,
        }}
      >
        <Text
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.56}
          maxFontSizeMultiplier={1}
          style={{
            width: "100%",
            color: theme.headline,
            fontSize: scale(headlineSize),
            lineHeight: scale(headlineLineHeight),
            fontWeight: "900",
            textAlign: "center",
            letterSpacing: 0,
          }}
        >
          {itemLine}
        </Text>
        {supportLine ? (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.62}
            maxFontSizeMultiplier={1}
            style={{
              width: "100%",
              marginTop: scale(12),
              color: theme.subline,
              fontSize: scale(34),
              lineHeight: scale(42),
              fontWeight: "900",
              textAlign: "center",
              letterSpacing: 0,
            }}
          >
            {supportLine}
          </Text>
        ) : null}
      </View>
    </>
  );
}

function PosterContent({
  copy,
  imageUri,
  templateId,
  scale,
}: {
  copy: PosterCopyV1;
  imageUri?: string | null;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  return (
    <>
      <PosterBackground imageUri={imageUri} templateId={templateId} />
      <TopCopyBlock copy={copy} templateId={templateId} scale={scale} />
      <OfferBlock copy={copy} templateId={templateId} scale={scale} />
    </>
  );
}

export function posterCopyFromSpec(spec: PosterSpecV1 | null | undefined): PosterCopyV1 | null {
  if (!spec?.enabled) return null;
  return spec.copy_by_language["en-US"] ?? Object.values(spec.copy_by_language)[0] ?? null;
}

export function AdPosterCanvas({ spec, copy, templateId, imageUri, style }: AdPosterCanvasProps) {
  const [width, setWidth] = useState(0);
  const scale = useScaled(width);
  const height = width > 0 ? Math.round((width * POSTER_CANVAS_HEIGHT) / POSTER_CANVAS_WIDTH) : undefined;
  const rawCopy = copy ?? posterCopyFromSpec(spec);
  const resolvedTemplate = posterTemplateOrDefault(templateId ?? spec?.template_id);
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
      <PosterContent
        copy={sanitized}
        imageUri={imageUri}
        templateId={resolvedTemplate}
        scale={scale}
      />
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
  bottomBand: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "75%",
    bottom: 0,
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
