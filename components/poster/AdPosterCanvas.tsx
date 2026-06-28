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
  sanitizePosterText,
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
  eyebrowLabel?: string | null;
  style?: StyleProp<ViewStyle>;
};

function useScaled(width: number) {
  return useMemo(() => {
    const ratio = width > 0 ? width / POSTER_CANVAS_WIDTH : 1;
    return (value: number) => Math.round(value * ratio);
  }, [width]);
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
  eyebrowLabel,
  scale,
}: {
  copy: PosterCopyV1;
  templateId: PosterTemplateId;
  eyebrowLabel: string;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  return (
    <>
      <PosterLine
        value={copy.business_name}
        top={14}
        left={72}
        width={936}
        size={40}
        lineHeight={46}
        color={theme.business}
        scale={scale}
      />
      {eyebrowLabel ? (
        <PosterLine
          value={eyebrowLabel}
          top={94}
          left={96}
          width={888}
          size={42}
          lineHeight={48}
          color={theme.accent}
          weight="800"
          scale={scale}
        />
      ) : null}
      <PosterLine
        value={copy.headline}
        top={154}
        left={72}
        width={936}
        size={78}
        lineHeight={84}
        color={theme.headline}
        lines={2}
        scale={scale}
      />
    </>
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
  const lineOneColor =
    templateId === "fresh" ? "#063D3A" : templateId === "bold" ? theme.accent : theme.accent;
  const lineTwoColor =
    templateId === "fresh" ? "#0F766E" : templateId === "bold" ? "#FFFFFF" : theme.headline;
  const sublineColor =
    templateId === "fresh" ? "#37635F" : templateId === "bold" ? "#FDE68A" : theme.subline;

  return (
    <View
      style={{
        position: "absolute",
        left: scale(72),
        top: scale(1030),
        width: scale(936),
        minHeight: scale(240),
        justifyContent: "center",
        alignItems: "center",
        zIndex: 8,
      }}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.54}
        maxFontSizeMultiplier={1}
        style={{
          width: "100%",
          color: lineOneColor,
          fontSize: scale(68),
          lineHeight: scale(76),
          fontWeight: "900",
          textAlign: "center",
          letterSpacing: 0,
        }}
      >
        {copy.offer_line_1}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.54}
        maxFontSizeMultiplier={1}
        style={{
          width: "100%",
          marginTop: scale(12),
          color: lineTwoColor,
          fontSize: scale(78),
          lineHeight: scale(86),
          fontWeight: "900",
          textAlign: "center",
          letterSpacing: 0,
        }}
      >
        {copy.offer_line_2}
      </Text>
      {copy.subline ? (
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          maxFontSizeMultiplier={1}
          style={{
            width: "100%",
            marginTop: scale(18),
            color: sublineColor,
            fontSize: scale(30),
            lineHeight: scale(36),
            fontWeight: "800",
            textAlign: "center",
            letterSpacing: 0,
          }}
        >
          {copy.subline}
        </Text>
      ) : null}
    </View>
  );
}

function PosterContent({
  copy,
  imageUri,
  templateId,
  eyebrowLabel,
  scale,
}: {
  copy: PosterCopyV1;
  imageUri?: string | null;
  templateId: PosterTemplateId;
  eyebrowLabel: string;
  scale: (value: number) => number;
}) {
  return (
    <>
      <PosterBackground imageUri={imageUri} templateId={templateId} />
      <TopCopyBlock copy={copy} templateId={templateId} eyebrowLabel={eyebrowLabel} scale={scale} />
      <OfferBlock copy={copy} templateId={templateId} scale={scale} />
    </>
  );
}

export function posterCopyFromSpec(spec: PosterSpecV1 | null | undefined): PosterCopyV1 | null {
  if (!spec?.enabled) return null;
  return spec.copy_by_language["en-US"] ?? Object.values(spec.copy_by_language)[0] ?? null;
}

export function AdPosterCanvas({ spec, copy, templateId, imageUri, eyebrowLabel, style }: AdPosterCanvasProps) {
  const [width, setWidth] = useState(0);
  const scale = useScaled(width);
  const height = width > 0 ? Math.round((width * POSTER_CANVAS_HEIGHT) / POSTER_CANVAS_WIDTH) : undefined;
  const rawCopy = copy ?? posterCopyFromSpec(spec);
  const resolvedTemplate = posterTemplateOrDefault(templateId ?? spec?.template_id);
  const sanitized = useMemo(() => {
    if (!rawCopy) return null;
    return sanitizePosterCopy(rawCopy, rawCopy.business_name || "Local Favorite").copy;
  }, [rawCopy]);
  const sanitizedEyebrow = useMemo(
    () => sanitizePosterText(eyebrowLabel ?? "", { fallback: "", maxChars: 18 }),
    [eyebrowLabel],
  );
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
      accessibilityLabel={`${sanitized.business_name} poster. ${sanitized.headline}. ${sanitized.offer_line_1}. ${sanitized.offer_line_2}.`}
    >
      <PosterContent
        copy={sanitized}
        imageUri={imageUri}
        templateId={resolvedTemplate}
        eyebrowLabel={sanitizedEyebrow}
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
