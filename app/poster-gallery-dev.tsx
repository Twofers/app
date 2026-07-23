// [aiqa] poster-quality run 2026-07-20 — DEV-ONLY poster gallery.
// Renders the fixed first-run corpus through the REAL AdPosterCanvas so
// renderer/typography/V1-vs-V2 iterations can be judged at zero image spend.
// Flip the look with a Metro restart: EXPO_PUBLIC_POSTER_LOOK_V2=true (V2) vs
// default (V1). Header self-documents which look is live so screenshots are
// unambiguous. Backgrounds load from the public deal-photos bucket (no auth),
// so the gallery works logged-out. Removable tooling; not shipped app logic.
//
// RUN 2 additions: a locale switch (en/es/ko) that drives both the copy and the
// display-font branch, a fontsLoaded readout for the D4 check, and the Tier-1
// stress cells appended to the corpus.
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";

import { BlackHanSans_400Regular } from "@expo-google-fonts/black-han-sans";
import { Outfit_900Black, useFonts } from "@expo-google-fonts/outfit";

import { AdPosterCanvas } from "@/components/poster/AdPosterCanvas";
import { buildPublicDealPhotoUrl } from "@/lib/deal-poster-url";
import { POSTER_GALLERY_ALL } from "@/lib/dev/poster-gallery-corpus";
import type { PosterCopyV1, PosterSpecV1 } from "@/lib/poster/posterTypes";
import { isPosterLookV2Enabled } from "@/lib/runtime-env";
import { useScreenInsets } from "@/lib/screen-layout";
import type { SupportedLocale } from "@/lib/supported-locales";

const LOCALES = ["en-US", "es-US", "ko-KR"] as const;

export default function PosterGalleryDevScreen() {
  const { top, horizontal, scrollBottom } = useScreenInsets("stack");
  const { width: screenW } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const [localeIdx, setLocaleIdx] = useState(0);
  const lookV2 = isPosterLookV2Enabled();
  const locale = LOCALES[localeIdx];

  // D4: AdPosterCanvas silently falls back to the system font when these fail to
  // load (by design — it must never render blank), so a Korean headline in the
  // system face looks "fine" while actually being a regression. expo-font caches
  // by family, so this mirrors the canvas's own fontsLoaded state.
  const [fontsLoaded] = useFonts({ Outfit_900Black, BlackHanSans_400Regular });

  const uris = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const cell of POSTER_GALLERY_ALL) {
      m[cell.id] = cell.sourcePath ? buildPublicDealPhotoUrl(cell.sourcePath) : null;
    }
    return m;
  }, []);

  const posterW = useMemo(() => Math.min(screenW - horizontal * 2, 460), [screenW, horizontal]);
  const cell = POSTER_GALLERY_ALL[idx];
  const localeCopy = cell.copyByLocale?.[locale] as PosterCopyV1 | undefined;

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

      {/* D4 font check — must read LOADED before any KO/V2 screenshot is trusted. */}
      <View
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 8,
          backgroundColor: fontsLoaded ? "#0d3b24" : "#5c1a1a",
        }}
      >
        <Text style={{ color: "#fff", fontWeight: "900" }}>
          D4 display fonts: {fontsLoaded ? "LOADED" : "NOT LOADED — system-font fallback in use"}
        </Text>
        <Text style={{ color: "#e5e7eb", fontSize: 11, marginTop: 2 }}>
          Outfit_900Black + BlackHanSans_400Regular · active face:{" "}
          {lookV2 && fontsLoaded ? (locale === "ko-KR" ? "BlackHanSans_400Regular" : "Outfit_900Black") : "system"}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Text style={{ fontWeight: "900", fontSize: 13 }}>locale</Text>
        {LOCALES.map((l, i) => (
          <Pressable
            key={l}
            onPress={() => setLocaleIdx(i)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: 8,
              backgroundColor: i === localeIdx ? "#1f2937" : "#d1d5db",
            }}
          >
            <Text style={{ color: i === localeIdx ? "#fff" : "#111", fontWeight: "900" }}>{l}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={{ fontWeight: "900", fontSize: 15 }}>
        [{idx + 1}/{POSTER_GALLERY_ALL.length}] {cell.id} — {cell.label}
      </Text>
      <Text style={{ color: "#666", fontSize: 12 }}>offer: {cell.offerLine ?? "(none)"}</Text>
      <Text style={{ color: "#666", fontSize: 12 }}>
        kicker: {cell.kicker ?? "(none)"} · photo_source: {cell.photoSource ?? "(none)"} · luma:{" "}
        {cell.luma ? `${cell.luma.top}/${cell.luma.bottom}` : "NULL (0.66 fallback)"}
      </Text>
      {cell.stressNote ? (
        <Text style={{ color: "#7c2d12", fontSize: 12, fontStyle: "italic" }}>probe: {cell.stressNote}</Text>
      ) : null}
      {localeCopy ? (
        <Text style={{ color: "#666", fontSize: 11 }}>
          copy override active for {locale} (headline {localeCopy.headline?.length ?? 0} chars, business{" "}
          {localeCopy.business_name?.length ?? 0})
        </Text>
      ) : null}
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
              copy={localeCopy}
              imageUri={uris[cell.id] ?? null}
              eyebrowLabel={cell.kicker}
              liveScheduleLabel="Redeem by Jul 20, 8:11 PM"
              contentLocale={locale as SupportedLocale}
              forceLookV2={variant.force}
            />
          </View>
        </View>
      ))}

      <View style={{ flexDirection: "row", gap: 12, justifyContent: "center", marginTop: 4 }}>
        <Pressable
          onPress={() => setIdx((i) => (i - 1 + POSTER_GALLERY_ALL.length) % POSTER_GALLERY_ALL.length)}
          style={{ paddingVertical: 12, paddingHorizontal: 22, borderRadius: 8, backgroundColor: "#1f2937" }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>◀ Prev</Text>
        </Pressable>
        <Pressable
          onPress={() => setIdx((i) => (i + 1) % POSTER_GALLERY_ALL.length)}
          style={{ paddingVertical: 12, paddingHorizontal: 22, borderRadius: 8, backgroundColor: "#1f2937" }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>Next ▶</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
