import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useScreenInsets, Spacing } from "../../lib/screen-layout";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { Banner } from "../../components/ui/banner";
import { redeemToken } from "../../lib/functions";

export default function RedeemScanner() {
  const { t } = useTranslation();
  const { height: winH } = useWindowDimensions();
  const { top, horizontal, scrollBottom } = useScreenInsets("tab");
  const router = useRouter();
  const { isLoggedIn, businessId, userId, loading, refresh } = useBusiness();
  const [businessName, setBusinessName] = useState("");
  const [isCreatingBusiness, setIsCreatingBusiness] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState<{ dealTitle: string; redeemedAt: string } | null>(null);

  async function createBusiness() {
    if (!userId) {
      setBanner({ message: t("redeem.errLogin"), tone: "error" });
      return;
    }

    const name = businessName.trim();
    if (!name) {
      setBanner({ message: t("redeem.errName"), tone: "error" });
      return;
    }

    setIsCreatingBusiness(true);
    setBanner(null);
    try {
      const { error } = await supabase.from("businesses").insert({ owner_id: userId, name });
      if (error) throw error;
      setBusinessName("");
      await refresh();
      router.replace("/(tabs)/redeem");
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("redeem.errCreateFailed"), tone: "error" });
    } finally {
      setIsCreatingBusiness(false);
    }
  }

  async function onScan(token: string) {
    if (processing || scanned) return;
    setProcessing(true);
    setScanned(true);
    setBanner(null);
    try {
      const result = await redeemToken(token);
      setSuccess({
        dealTitle: result.deal_title ?? t("redeem.defaultDealTitle"),
        redeemedAt: result.redeemed_at,
      });
    } catch (err: any) {
      setBanner({ message: err?.message ?? t("redeem.errRedeemFailed"), tone: "error" });
      setScanned(false);
    } finally {
      setProcessing(false);
    }
  }

  useEffect(() => {
    if (!permission) return;
    if (permission.granted) return;
  }, [permission]);

  const cameraBlockHeight = Math.round(Math.min(420, Math.max(260, winH * 0.42)));

  return (
    <View style={{ paddingTop: top, paddingHorizontal: horizontal, flex: 1 }}>
      <Text style={{ fontSize: 26, fontWeight: "700", letterSpacing: -0.3 }}>{t("redeem.title")}</Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {!isLoggedIn ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("redeem.loginPrompt")}</Text>
      ) : loading ? (
        <Text style={{ marginTop: Spacing.lg, opacity: 0.7 }}>{t("redeem.loading")}</Text>
      ) : !businessId ? (
        <View style={{ marginTop: Spacing.lg, gap: Spacing.md }}>
          <Text style={{ fontWeight: "700", fontSize: 16 }}>{t("redeem.createHeader")}</Text>
          <Text style={{ opacity: 0.7 }}>{t("redeem.createBody")}</Text>
          <TextInput
            value={businessName}
            onChangeText={setBusinessName}
            placeholder={t("redeem.placeholderBusiness")}
            autoCapitalize="words"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
            }}
          />
          <PrimaryButton
            title={isCreatingBusiness ? t("redeem.creating") : t("redeem.createBusiness")}
            onPress={createBusiness}
            disabled={isCreatingBusiness}
          />
        </View>
      ) : !permission ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ opacity: 0.7 }}>{t("redeem.requestingCamera")}</Text>
        </View>
      ) : !permission.granted ? (
        <View style={{ marginTop: Spacing.lg }}>
          <Text style={{ opacity: 0.7, marginBottom: Spacing.md }}>{t("redeem.cameraRequired")}</Text>
          <PrimaryButton title={t("redeem.grantPermission")} onPress={requestPermission} />
        </View>
      ) : success ? (
        <View style={{ marginTop: Spacing.lg, paddingBottom: scrollBottom }}>
          <View
            style={{
              borderRadius: 18,
              padding: Spacing.lg,
              backgroundColor: "#e8f5e9",
            }}
          >
            <Text style={{ fontWeight: "700", fontSize: 17 }}>{t("redeem.redeemed")}</Text>
            <Text style={{ marginTop: Spacing.sm, fontSize: 16 }}>{success.dealTitle}</Text>
            <Text style={{ marginTop: Spacing.sm, opacity: 0.72, fontSize: 14 }}>
              {t("redeem.redeemedAt")} {new Date(success.redeemedAt).toLocaleString()}
            </Text>
          </View>
          <View style={{ marginTop: Spacing.md }}>
            <SecondaryButton
              title="Scan next"
              onPress={() => {
                setSuccess(null);
                setScanned(false);
              }}
            />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: Spacing.lg, flex: 1, paddingBottom: scrollBottom }}>
          <View
            style={{
              borderRadius: 18,
              overflow: "hidden",
              backgroundColor: "#000",
              height: cameraBlockHeight,
            }}
          >
            <CameraView
              style={{ height: "100%", width: "100%" }}
              facing="back"
              onBarcodeScanned={scanned ? undefined : (result) => onScan(result.data)}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            />
            {processing ? (
              <View
                style={{
                  position: "absolute",
                  inset: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(0,0,0,0.5)",
                }}
              >
                <ActivityIndicator size="large" color="#fff" />
                <Text style={{ color: "#fff", marginTop: 8 }}>{t("redeem.redeeming")}</Text>
              </View>
            ) : null}
          </View>
          <Pressable
            onPress={() => setScanned(false)}
            style={{
              marginTop: Spacing.md,
              paddingVertical: Spacing.md,
              borderRadius: 12,
              backgroundColor: "#eee",
            }}
          >
            <Text style={{ textAlign: "center", fontWeight: "700" }}>{t("redeem.scanNext")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
