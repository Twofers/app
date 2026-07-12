import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { SvgXml } from "react-native-svg";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { AppleWalletPassButton, presentAppleWalletPass } from "@/lib/apple-wallet-native";
import { fetchAppleWalletPassBase64, issueWalletPass } from "@/lib/wallet-pass-functions";
import { isNativeWalletPassEnabled } from "@/lib/runtime-env";
import { addToGoogleWalletSvg } from "@/lib/google-wallet-badges";
import {
  getNativeWalletPassAdded,
  setNativeWalletPassAdded,
} from "@/lib/native-wallet-pass-storage";

const GOOGLE_BADGE_ASPECT = { en: 283 / 50, es: 378 / 50 } as const;
const BADGE_MAX_HEIGHT = 50;

/**
 * "Add to Wallet" for the Twofer Card (docs/plans/native-wallet-pass-plan.md).
 * Renders nothing unless the flag is on. Android → Google Wallet (save link).
 * iOS → Apple's system PKAddPassButton, then PKAddPassesViewController for the
 * signed .pkpass. The local Expo module keeps both UI pieces native to PassKit.
 */
export function AddToWalletButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t, i18n } = useTranslation();
  const [added, setAdded] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const isApple = Platform.OS === "ios";
  const isGoogle = Platform.OS === "android";
  const visible = isNativeWalletPassEnabled() && (isApple || isGoogle);

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

  if (!visible) return null;
  // Android hides the button once the card is added. iOS keeps the system
  // button because PassKit owns the final add/cancel decision in its sheet.
  if (isGoogle && added !== false) return null;

  async function onPressGoogle() {
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

  async function onPressApple() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const b64 = await fetchAppleWalletPassBase64(i18n.language);
      await presentAppleWalletPass(b64);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const errorText = failed ? (
    <Text
      style={{ marginTop: 6, color: "#B91C1C", fontSize: 13, fontWeight: "600", textAlign: "center" }}
      maxFontSizeMultiplier={1.15}
    >
      {t("walletPass.errAdd", { defaultValue: "Couldn't add your Twofer Card. Try again." })}
    </Text>
  ) : null;

  if (isApple) {
    return (
      <View style={[{ alignItems: "center" }, style]}>
        <View style={{ width: 220, height: 48 }}>
          <AppleWalletPassButton
            disabled={busy}
            onPress={() => void onPressApple()}
            style={{ width: "100%", height: "100%", opacity: busy ? 0.6 : 1 }}
          />
          {busy ? (
            <View
              pointerEvents="none"
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
        {errorText}
      </View>
    );
  }

  // Android — official Google Wallet badge (vector).
  const aspect = i18n.language === "es" ? GOOGLE_BADGE_ASPECT.es : GOOGLE_BADGE_ASPECT.en;
  return (
    <View style={style}>
      <HapticScalePressable
        onPress={() => void onPressGoogle()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("walletPass.addToGoogleWallet", { defaultValue: "Add to Google Wallet" })}
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
      {errorText}
    </View>
  );
}
