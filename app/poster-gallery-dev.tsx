// [aiqa] poster-quality run 2026-07-20 — DEV-ONLY poster gallery.
// Renders the fixed first-run corpus through the REAL AdPosterCanvas so
// renderer/typography/V1-vs-V2 iterations can be judged at zero image spend.
// Flip the look with a Metro restart: EXPO_PUBLIC_POSTER_LOOK_V2=true (V2) vs
// default (V1). Header self-documents which look is live so screenshots are
// unambiguous. Backgrounds load from the public deal-photos bucket (no auth),
// so the gallery works logged-out. Removable tooling; not shipped app logic.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import { buildPublicDealPhotoUrl } from "@/lib/deal-poster-url";
import { POSTER_GALLERY_CORPUS } from "@/lib/dev/poster-gallery-corpus";
import type { PosterSpecV1 } from "@/lib/poster/posterTypes";
import { isPosterLookV2Enabled } from "@/lib/runtime-env";
import { useScreenInsets } from "@/lib/screen-layout";

export default function PosterGalleryDevScreen() {
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { width: screenW } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const lookV2 = isPosterLookV2Enabled();

  const uris = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const cell of POSTER_GALLERY_CORPUS) {
      m[cell.id] = cell.sourcePath ? buildPublicDealPhotoUrl(cell.sourcePath) : null;
    }
    return m;
  }, []);

  const posterW = useMemo(() => Math.min(screenW - horizontal * 2, 460), [screenW, horizontal]);
  const cell = POSTER_GALLERY_CORPUS[idx];

  if (!__DEV__) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text>Poster gallery is a dev-only tool.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingTop: top + 8,
        paddingHorizontal: horizontal,
        paddingBottom: scrollBottom + 24,
        gap: 12,
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: "900" }}>Poster Gallery (dev)</Text>

      <View
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: lookV2 ? "#12331b" : "#331212",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900", letterSpacing: 1 }}>
          V1 vs V2 A/B · runtime flag = {lookV2 ? "V2" : "V1"}
        </Text>
      </View>

      <Text style={{ fontWeight: "900", fontSize: 15 }}>
        [{idx + 1}/{POSTER_GALLERY_CORPUS.length}] {cell.id} — {cell.label}
      </Text>
      <Text style={{ color: "#666", fontSize: 12 }}>offer: {cell.offerLine ?? "(none)"}</Text>
      <Text style={{ color: "#666", fontSize: 12 }}>
        kicker: {cell.kicker ?? "(none)"} · photo_source: {cell.photoSource ?? "(none)"}
      </Text>
      {!uris[cell.id] ? (
        <Text style={{ color: "#c00", fontSize: 12 }}>no background url (template gradient only)</Text>
      ) : null}

      {([
        { label: "V1 (shipped)", force: false },
        { label: "V2 (POSTER_LOOK_V2 candidate)", force: true },
      ] as const).map((variant) => (
        <View key={variant.label} style={{ gap: 6 }}>
          <Text style={{ fontWeight: "900", fontSize: 13, color: "#111" }}>{variant.label}</Text>
          <View style={{ width: posterW, alignSelf: "center" }}>
            <AdPosterCanvas
              spec={{ ...(cell.spec as object), luma: cell.luma } as unknown as PosterSpecV1}
              imageUri={uris[cell.id] ?? null}
              eyebrowLabel={cell.kicker}
              liveScheduleLabel="Redeem by Jul 20, 8:11 PM"
              contentLocale="en-US"
              forceLookV2={variant.force}
            />
          </View>
        </View>
      ))}

      <View style={{ flexDirection: "row", gap: 12, justifyContent: "center", marginTop: 4 }}>
        <Pressable
          onPress={() => setIdx((i) => (i - 1 + POSTER_GALLERY_CORPUS.length) % POSTER_GALLERY_CORPUS.length)}
          style={{ paddingVertical: 12, paddingHorizontal: 22, borderRadius: 8, backgroundColor: "#1f2937" }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>◀ Prev</Text>
        </Pressable>
        <Pressable
          onPress={() => setIdx((i) => (i + 1) % POSTER_GALLERY_CORPUS.length)}
          style={{ paddingVertical: 12, paddingHorizontal: 22, borderRadius: 8, backgroundColor: "#1f2937" }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Next ▶</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
