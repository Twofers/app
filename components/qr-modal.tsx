import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import QRCode from "react-native-qrcode-svg";
import { formatAppDateTime } from "../lib/i18n/format-datetime";

type QrModalProps = {
  visible: boolean;
  token: string | null;
  expiresAt: string | null;
  onHide: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function QrModal({ visible, token, expiresAt, onHide, onRefresh, refreshing }: QrModalProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [remaining, setRemaining] = useState<string | null>(null);
  const [tick, setTick] = useState(false);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(null);
      return;
    }
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      const mins = Math.floor(diff / 60);
      const secs = diff % 60;
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
      setTick((prev) => !prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          alignItems: "center",
          padding: 16,
        }}
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 18,
            padding: 16,
            paddingBottom: Math.max(16, insets.bottom + 8),
            width: "100%",
            maxWidth: 400,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 10 }}>
            {t("consumerWallet.qrModalTitle")}
          </Text>
          <View style={{ alignItems: "center", marginBottom: 10 }}>
            {token ? <QRCode value={token} size={220} /> : null}
          </View>
          <Text style={{ opacity: 0.75, textAlign: "center" }}>
            {t("consumerWallet.qrValidUntil", {
              time: `${remaining ?? "--"}${tick ? " •" : " "}`,
            })}
          </Text>
          {expiresAt ? (
            <Text style={{ opacity: 0.6, textAlign: "center", marginTop: 4 }}>
              {t("consumerWallet.qrExpiresAt", {
                datetime: formatAppDateTime(expiresAt, i18n.language),
              })}
            </Text>
          ) : null}

          <View style={{ marginTop: 14 }}>
            <Pressable
              onPress={onHide}
              style={{
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "#111",
                marginBottom: 8,
              }}
            >
              <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>
                {t("consumerWallet.hideQr")}
              </Text>
            </Pressable>
            {onRefresh ? (
              <Pressable
                onPress={onRefresh}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: "#eee",
                }}
              >
                <Text style={{ color: "#111", fontWeight: "700", textAlign: "center" }}>
                  {refreshing ? t("consumerWallet.refreshingQrModal") : t("consumerWallet.refreshQr")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
