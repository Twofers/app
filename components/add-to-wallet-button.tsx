import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { SvgXml } from "react-native-svg";
import { File as ExpoFsFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { HapticScalePressable } from "@/components/ui/haptic-scale-pressable";
import { Radii } from "@/constants/theme";
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
 * iOS → Apple Wallet: fetches the signed .pkpass and hands it to PassKit via
 * the iOS share sheet (which offers "Add to Apple Wallet" for .pkpass files),
 * so no native module / custom build config is required.
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
  // Android hides the button once the card is added; iOS keeps it (the share
  // sheet can't reliably tell us whether the user actually added the pass).
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
      const file = new ExpoFsFile(Paths.cache, `twofer-card-${Date.now()}.pkpass`);
      file.create({ overwrite: true, intermediates: true });
      file.write(b64, { encoding: "base64" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          UTI: "com.apple.pkpass",
          mimeType: "application/vnd.apple.pkpass",
        });
      } else {
        setFailed(true);
      }
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
    // TODO(wallet-pass): replace this interim badge with Apple's official
    // "Add to Apple Wallet" artwork. Downloading it requires accepting Apple's
    // Wallet Marketing Agreement (developer.apple.com/wallet/add-to-apple-wallet-guidelines).
    // Do NOT ship to the App Store with this interim badge.
    return (
      <View style={style}>
        <HapticScalePressable
          onPress={() => void onPressApple()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t("walletPass.addToAppleWallet", { defaultValue: "Add to Apple Wallet" })}
          style={{
            minHeight: 48,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            borderRadius: Radii.lg,
            backgroundColor: "#000000",
            opacity: busy ? 0.6 : 1,
            paddingHorizontal: 16,
          }}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              maxFontSizeMultiplier={1.15}
            >
              {t("walletPass.addToAppleWallet", { defaultValue: "Add to Apple Wallet" })}
            </Text>
          )}
        </HapticScalePressable>
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
