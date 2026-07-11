import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { SvgXml } from "react-native-svg";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { issueWalletPass } from "@/lib/wallet-pass-functions";
import { isNativeWalletPassEnabled } from "@/lib/runtime-env";
import { addToGoogleWalletSvg } from "@/lib/google-wallet-badges";
import {
  getNativeWalletPassAdded,
  setNativeWalletPassAdded,
} from "@/lib/native-wallet-pass-storage";

// Official button artwork intrinsic sizes (from Google's asset viewBoxes). Used
// to size the badge without distorting it — brand rules forbid stretching.
const BADGE_ASPECT = { en: 283 / 50, es: 378 / 50 } as const;
const BADGE_MAX_HEIGHT = 50;

/**
 * "Add to Google Wallet" for the Twofer Card (docs/plans/native-wallet-pass-plan.md).
 * Renders nothing unless the flag is on, the platform is Android (Google-first
 * phase; Apple lands with the pkpass work), and this device hasn't already
 * added the card. Uses Google's official localized badge (en/es; Korean has no
 * official button so it falls back to the English one, per Google's guidance),
 * rendered as vector so it stays crisp at any size.
 */
export function AddToWalletButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t, i18n } = useTranslation();
  const [added, setAdded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const visible = isNativeWalletPassEnabled() && Platform.OS === "android";

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getNativeWalletPassAdded().then((value) => {
      if (!cancelled) setAdded(value);
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  if (!visible || added !== false) return null;

  async function onPress() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { save_url } = await issueWalletPass("google", i18n.language);
      await Linking.openURL(save_url);
      await setNativeWalletPassAdded();
      setAdded(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const aspect = i18n.language === "es" ? BADGE_ASPECT.es : BADGE_ASPECT.en;

  return (
    <View style={style}>
      <HapticScalePressable
        onPress={() => void onPress()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={
          busy
            ? t("walletPass.preparing", { defaultValue: "Opening Google Wallet..." })
            : t("walletPass.addToGoogleWallet", { defaultValue: "Add to Google Wallet" })
        }
        style={{ alignItems: "center", opacity: busy ? 0.6 : 1 }}
      >
        <View style={{ width: "100%", maxWidth: aspect * BADGE_MAX_HEIGHT, aspectRatio: aspect }}>
          <SvgXml xml={addToGoogleWalletSvg(i18n.language)} width="100%" height="100%" />
          {busy ? (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
      </HapticScalePressable>
      {failed ? (
        <Text
          style={{ marginTop: 6, color: "#B91C1C", fontSize: 13, fontWeight: "600", textAlign: "center" }}
          maxFontSizeMultiplier={1.15}
        >
          {t("walletPass.errAdd", { defaultValue: "Couldn't add your Twofer Card. Try again." })}
        </Text>
      ) : null}
    </View>
  );
}
