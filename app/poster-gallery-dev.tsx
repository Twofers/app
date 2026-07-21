// [aiqa] poster-quality run 2026-07-20 — DEV-ONLY poster gallery.
// Renders the fixed first-run corpus through the REAL AdPosterCanvas so
// renderer/typography/V1-vs-V2 iterations can be judged at zero image spend.
// Flip the look with a Metro restart: EXPO_PUBLIC_POSTER_LOOK_V2=true (V2) vs
// default (V1). Header self-documents which look is live so screenshots are
// unambiguous. Removable tooling; not shipped app logic.
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import type { PosterSpecV1 } from "@/lib/poster/posterTypes";
import { POSTER_GALLERY_CORPUS } from "@/lib/dev/poster-gallery-corpus";
import { isPosterLookV2Enabled } from "@/lib/runtime-env";
import { useScreenInsets } from "@/lib/screen-layout";
import { supabase } from "@/lib/supabase";

const BUCKET = "deal-photos";
const SIGNED_URL_TTL_SECONDS = 3600;

export default function PosterGalleryDevScreen() {
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { width: screenW } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const [uris, setUris] = useState<Record<string, string | null>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const lookV2 = isPosterLookV2Enabled();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const cell of POSTER_GALLERY_CORPUS) {
        if (!cell.sourcePath) continue;
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(cell.sourcePath, SIGNED_URL_TTL_SECONDS);
        if (cancelled) return;
        if (error) {
          setErrs((e) => ({ ...e, [cell.id]: error.message }));
        } else {
          setUris((u) => ({ ...u, [cell.id]: data?.signedUrl ?? null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
          LOOK: {lookV2 ? "V2  (POSTER_LOOK_V2=true)" : "V1  (default)"}
        </Text>
      </View>

      <Text style={{ fontWeight: "900", fontSize: 15 }}>
        [{idx + 1}/{POSTER_GALLERY_CORPUS.length}] {cell.id} — {cell.label}
      </Text>
      <Text style={{ color: "#666", fontSize: 12 }}>
        offer: {cell.offerLine ?? "(none)"}
      </Text>
      <Text style={{ color: "#666", fontSize: 12 }}>
        kicker: {cell.kicker ?? "(none)"} · photo_source: {cell.photoSource ?? "(none)"}
      </Text>
      {errs[cell.id] ? (
        <Text style={{ color: "#c00", fontSize: 12 }}>image error: {errs[cell.id]}</Text>
      ) : !uris[cell.id] ? (
        <Text style={{ color: "#999", fontSize: 12 }}>loading background…</Text>
      ) : null}

      <View style={{ width: posterW, alignSelf: "center" }}>
        <AdPosterCanvas
          spec={cell.spec as PosterSpecV1}
          imageUri={uris[cell.id] ?? null}
          eyebrowLabel={cell.kicker}
          liveScheduleLabel="Redeem by Jul 20, 8:11 PM"
          contentLocale="en-US"
        />
      </View>

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
