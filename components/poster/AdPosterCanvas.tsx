import { useMemo, useState } from "react";
import {
  Image,
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

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "LF"
  );
}

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

function PosterImage({
  imageUri,
  templateId,
  scale,
}: {
  imageUri?: string | null;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  const isPremium = templateId === "premium";
  const frame = isPremium
    ? { left: 0, top: 0, width: POSTER_CANVAS_WIDTH, height: POSTER_CANVAS_HEIGHT, radius: 0 }
    : templateId === "bold"
      ? { left: 86, top: 390, width: 908, height: 610, radius: 34 }
      : { left: 140, top: 390, width: 800, height: 650, radius: 400 };
  const rounded = templateId === "fresh";

  return (
    <View
      style={{
        position: "absolute",
        left: scale(frame.left),
        top: scale(frame.top),
        width: scale(frame.width),
        height: scale(frame.height),
        borderRadius: scale(rounded ? frame.width / 2 : frame.radius),
        overflow: "hidden",
        backgroundColor: "rgba(255,255,255,0.24)",
      }}
    >
      {imageUri ? (
        <Image source={{ uri: imageUri }} resizeMode="cover" style={StyleSheet.absoluteFillObject} />
      ) : (
        <LinearGradient
          colors={["#FDE68A", "#FB923C"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}

function OfferPanel({
  copy,
  templateId,
  scale,
}: {
  copy: PosterCopyV1;
  templateId: PosterTemplateId;
  scale: (value: number) => number;
}) {
  const theme = POSTER_TEMPLATES[templateId];
  const panelTop = templateId === "fresh" ? 1058 : 1030;
  return (
    <View
      style={{
        position: "absolute",
        left: scale(100),
        top: scale(panelTop),
        width: scale(880),
        minHeight: scale(190),
        borderRadius: scale(templateId === "bold" ? 22 : 8),
        backgroundColor: theme.panel,
        borderWidth: scale(2),
        borderColor: templateId === "bold" ? "rgba(255,255,255,0.76)" : theme.border,
        paddingHorizontal: scale(34),
        paddingVertical: scale(28),
        justifyContent: "center",
        zIndex: 8,
      }}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.55}
        maxFontSizeMultiplier={1}
        style={{
          color: theme.panelText,
          fontSize: scale(62),
          lineHeight: scale(68),
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
        minimumFontScale={0.55}
        maxFontSizeMultiplier={1}
        style={{
          marginTop: scale(8),
          color: theme.panelText,
          fontSize: scale(72),
          lineHeight: scale(78),
          fontWeight: "900",
          textAlign: "center",
          letterSpacing: 0,
        }}
      >
        {copy.offer_line_2}
      </Text>
    </View>
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
  const theme = POSTER_TEMPLATES[templateId];
  const hasFullImage = templateId === "premium" && imageUri;

  return (
    <>
      {hasFullImage ? (
        <ImageBackground source={{ uri: imageUri }} resizeMode="cover" style={StyleSheet.absoluteFillObject} />
      ) : (
        <LinearGradient
          colors={theme.background}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.imageTint }]} />
      {templateId === "bold" ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            right: scale(-120),
            top: scale(38),
            width: scale(420),
            height: scale(420),
            borderRadius: scale(210),
            backgroundColor: "rgba(251,191,36,0.22)",
          }}
        />
      ) : null}
      {templateId === "fresh" ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: scale(-90),
            top: scale(900),
            width: scale(1260),
            height: scale(360),
            borderRadius: scale(180),
            backgroundColor: "rgba(255,255,255,0.26)",
            transform: [{ rotate: "-8deg" }],
          }}
        />
      ) : null}
      {templateId !== "premium" ? <PosterImage imageUri={imageUri} templateId={templateId} scale={scale} /> : null}
      {templateId === "premium" ? <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.36)" }]} /> : null}

      <View
        style={{
          position: "absolute",
          left: scale(120),
          top: scale(68),
          width: scale(840),
          alignItems: "center",
          zIndex: 7,
        }}
      >
        <View
          style={{
            width: scale(82),
            height: scale(82),
            borderRadius: scale(20),
            backgroundColor: templateId === "bold" ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.34)",
            alignItems: "center",
            justifyContent: "center",
            borderWidth: scale(2),
            borderColor: theme.border,
          }}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1}
            style={{ color: theme.business, fontSize: scale(32), lineHeight: scale(38), fontWeight: "900" }}
          >
            {initials(copy.business_name)}
          </Text>
        </View>
      </View>
      <PosterLine
        value={copy.business_name}
        top={170}
        left={96}
        width={888}
        size={38}
        lineHeight={44}
        color={theme.business}
        scale={scale}
      />
      <PosterLine
        value={copy.headline}
        top={244}
        left={92}
        width={896}
        size={72}
        lineHeight={78}
        color={theme.headline}
        lines={2}
        scale={scale}
      />
      {copy.subline ? (
        <PosterLine
          value={copy.subline}
          top={1248}
          left={120}
          width={840}
          size={30}
          lineHeight={36}
          color={templateId === "bold" ? "#FFFFFF" : theme.subline}
          weight="800"
          scale={scale}
        />
      ) : null}
      <OfferPanel copy={copy} templateId={templateId} scale={scale} />
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
      accessibilityLabel={`${sanitized.business_name} poster. ${sanitized.headline}. ${sanitized.offer_line_1}. ${sanitized.offer_line_2}.`}
    >
      <PosterContent copy={sanitized} imageUri={imageUri} templateId={resolvedTemplate} scale={scale} />
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
});
