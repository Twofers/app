import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Banner } from "@/components/ui/banner";
import { PrimaryButton } from "@/components/ui/primary-button";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HapticScalePressable as Pressable } from "@/components/ui/haptic-scale-pressable";
import { useOwnerRedemptionSecurity } from "@/components/providers/owner-redemption-security-provider";
import { useRedemptionMode } from "@/components/providers/redemption-mode-provider";
import { Colors, Radii } from "@/constants/theme";
import { useBrandedConfirm } from "@/hooks/use-branded-confirm";
import { useColorScheme } from "@/hooks/use-color-scheme";
import {
  changeOwnerRedemptionPin,
  disableOwnerRedemptionPin,
  enableOwnerRedemptionPin,
  getOwnerRedemptionSecurityStatus,
  type OwnerRedemptionSecurityStatus,
} from "@/lib/owner-redemption-security";
import {
  activateRedemptionMode,
  deactivateRedemptionDevice,
  listRedemptionDevices,
  removeRedemptionDevice,
  type RedemptionDeviceSummary,
} from "@/lib/redemption-mode";
import { Spacing } from "@/lib/screen-layout";

type Props = {
  businessId: string | null;
  businessName?: string | null;
};

function formatDeviceStatus(device: RedemptionDeviceSummary, t: TFunction): string {
  if (device.active) return t("redemptionMode.statusActive", { defaultValue: "Active" });
  if (device.deactivated_at) return t("redemptionMode.statusInactive", { defaultValue: "Inactive" });
  return t("redemptionMode.statusReady", { defaultValue: "Ready" });
}

export function RedemptionModeSettings({ businessId, businessName }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { refresh } = useRedemptionMode();
  const { clearUnlock, markUnlocked, setPinEnabled } = useOwnerRedemptionSecurity();
  const colorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = Colors[colorScheme];
  const { confirm, confirmModal } = useBrandedConfirm();
  const [open, setOpen] = useState(false);
  const [ownerSecurity, setOwnerSecurity] = useState<OwnerRedemptionSecurityStatus | null>(null);
  const [loadingOwnerSecurity, setLoadingOwnerSecurity] = useState(false);
  const [savingOwnerSecurity, setSavingOwnerSecurity] = useState(false);
  const [ownerPin, setOwnerPin] = useState("");
  const [ownerPinConfirm, setOwnerPinConfirm] = useState("");
  const [ownerDisablePin, setOwnerDisablePin] = useState("");
  const [ownerNewPin, setOwnerNewPin] = useState("");
  const [ownerNewPinConfirm, setOwnerNewPinConfirm] = useState("");
  const defaultDeviceLabel = t("redemptionMode.defaultDeviceLabel", { defaultValue: "Front counter iPhone" });
  const [deviceLabel, setDeviceLabel] = useState(defaultDeviceLabel);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [activating, setActivating] = useState(false);
  const [devices, setDevices] = useState<RedemptionDeviceSummary[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" | "warning" } | null>(null);

  useEffect(() => {
    if (!businessName || deviceLabel !== defaultDeviceLabel) return;
    setDeviceLabel(t("redemptionMode.businessCounterLabel", { defaultValue: "{{name}} Counter", name: businessName.slice(0, 30) }));
  }, [businessName, defaultDeviceLabel, deviceLabel, t]);

  const reloadOwnerSecurity = useCallback(async () => {
    if (!businessId) return;
    setLoadingOwnerSecurity(true);
    try {
      const status = await getOwnerRedemptionSecurityStatus(businessId);
      setOwnerSecurity(status);
      setPinEnabled(businessId, status.enabled);
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.ownerPinLoadFailed", { defaultValue: "Could not load owner redemption PIN settings." }),
        tone: "error",
      });
    } finally {
      setLoadingOwnerSecurity(false);
    }
  }, [businessId, setPinEnabled, t]);

  const reloadDevices = useCallback(async () => {
    if (!businessId) return;
    setLoadingDevices(true);
    try {
      setDevices(await listRedemptionDevices(businessId));
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.devicesLoadFailed", { defaultValue: "Could not load redemption devices." }),
        tone: "error",
      });
    } finally {
      setLoadingDevices(false);
    }
  }, [businessId, t]);

  useEffect(() => {
    if (!open || !businessId) return;
    void reloadOwnerSecurity();
    void reloadDevices();
  }, [open, businessId, reloadDevices, reloadOwnerSecurity]);

  async function enableOwnerPin() {
    if (!businessId || savingOwnerSecurity) return;
    const pinValue = ownerPin.trim();
    if (!/^\d{4,6}$/.test(pinValue)) {
      setBanner({ message: t("redemptionMode.ownerPinRequired", { defaultValue: "Enter a 4-6 digit redemption PIN." }), tone: "error" });
      return;
    }
    if (pinValue !== ownerPinConfirm.trim()) {
      setBanner({ message: t("redemptionMode.pinMismatch", { defaultValue: "PINs do not match." }), tone: "error" });
      return;
    }
    setSavingOwnerSecurity(true);
    setBanner(null);
    try {
      await enableOwnerRedemptionPin(businessId, pinValue);
      markUnlocked(businessId);
      setPinEnabled(businessId, true);
      setOwnerSecurity({ enabled: true, hasPin: true, lockedUntil: null });
      setOwnerPin("");
      setOwnerPinConfirm("");
      setBanner({
        message: t("redemptionMode.ownerPinEnabled", { defaultValue: "Owner redemption PIN enabled." }),
        tone: "success",
      });
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.ownerPinSaveFailed", { defaultValue: "Could not update owner redemption PIN." }),
        tone: "error",
      });
    } finally {
      setSavingOwnerSecurity(false);
    }
  }

  async function disableOwnerPin() {
    if (!businessId || savingOwnerSecurity) return;
    const pinValue = ownerDisablePin.trim();
    if (ownerSecurity?.enabled && !/^\d{4,6}$/.test(pinValue)) {
      setBanner({ message: t("redemptionMode.ownerPinRequired", { defaultValue: "Enter a 4-6 digit redemption PIN." }), tone: "error" });
      return;
    }
    setSavingOwnerSecurity(true);
    setBanner(null);
    try {
      await disableOwnerRedemptionPin(businessId, pinValue || undefined);
      clearUnlock(businessId);
      setPinEnabled(businessId, false);
      // Server clears pin_hash on disable; re-enabling is a fresh setup.
      setOwnerSecurity({ enabled: false, hasPin: false, lockedUntil: null });
      setOwnerDisablePin("");
      setBanner({
        message: t("redemptionMode.ownerPinDisabled", { defaultValue: "Owner redemption PIN disabled." }),
        tone: "success",
      });
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.ownerPinSaveFailed", { defaultValue: "Could not update owner redemption PIN." }),
        tone: "error",
      });
    } finally {
      setSavingOwnerSecurity(false);
    }
  }

  async function changeOwnerPin() {
    if (!businessId || savingOwnerSecurity) return;
    const currentPin = ownerDisablePin.trim();
    const newPin = ownerNewPin.trim();
    if (!/^\d{4,6}$/.test(currentPin)) {
      setBanner({ message: t("redemptionMode.currentPinRequired", { defaultValue: "Enter the current redemption PIN." }), tone: "error" });
      return;
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      setBanner({ message: t("redemptionMode.newPinRequired", { defaultValue: "Enter a new 4-6 digit redemption PIN." }), tone: "error" });
      return;
    }
    if (newPin !== ownerNewPinConfirm.trim()) {
      setBanner({ message: t("redemptionMode.pinMismatch", { defaultValue: "PINs do not match." }), tone: "error" });
      return;
    }
    setSavingOwnerSecurity(true);
    setBanner(null);
    try {
      await changeOwnerRedemptionPin(businessId, currentPin, newPin);
      markUnlocked(businessId);
      setPinEnabled(businessId, true);
      setOwnerSecurity({ enabled: true, hasPin: true, lockedUntil: null });
      setOwnerDisablePin("");
      setOwnerNewPin("");
      setOwnerNewPinConfirm("");
      setBanner({
        message: t("redemptionMode.ownerPinChanged", { defaultValue: "Owner redemption PIN changed." }),
        tone: "success",
      });
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.ownerPinSaveFailed", { defaultValue: "Could not update owner redemption PIN." }),
        tone: "error",
      });
    } finally {
      setSavingOwnerSecurity(false);
    }
  }

  async function startRedemptionMode() {
    if (!businessId || activating) return;
    const label = deviceLabel.trim();
    if (!label) {
      setBanner({ message: t("redemptionMode.labelRequired", { defaultValue: "Enter a device label." }), tone: "error" });
      return;
    }
    if (!/^\d{4,6}$/.test(pin.trim())) {
      setBanner({ message: t("redemptionMode.exitPinSetupRequired", { defaultValue: "Enter a 4-6 digit exit PIN." }), tone: "error" });
      return;
    }
    if (pin.trim() !== pinConfirm.trim()) {
      setBanner({ message: t("redemptionMode.exitPinMismatch", { defaultValue: "Exit PINs do not match." }), tone: "error" });
      return;
    }
    setActivating(true);
    setBanner(null);
    try {
      await activateRedemptionMode({ businessId, deviceLabel: label, pin: pin.trim() });
      await refresh();
      router.replace("/redemption-mode" as Href);
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.activateFailed", { defaultValue: "Could not activate Redemption Mode." }),
        tone: "error",
      });
    } finally {
      setActivating(false);
    }
  }

  async function deactivateDevice(deviceId: string) {
    if (!businessId) return;
    try {
      await deactivateRedemptionDevice(businessId, deviceId);
      await reloadDevices();
      setBanner({ message: t("redemptionMode.deviceDeactivated", { defaultValue: "Device deactivated." }), tone: "success" });
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.deviceUpdateFailed", { defaultValue: "Could not update device." }),
        tone: "error",
      });
    }
  }

  function confirmRemoveDevice(device: RedemptionDeviceSummary) {
    confirm({
      iconName: "warning",
      title: t("redemptionMode.removeDeviceTitle", { defaultValue: "Remove redemption device?" }),
      message: t("redemptionMode.removeDeviceBody", {
        defaultValue:
          "Removing this device ends its staff session and stops future staff redemptions. The device holds no owner login.",
      }),
      confirmLabel: t("redemptionMode.removeDeviceCta", { defaultValue: "Remove device" }),
      cancelLabel: t("commonUi.cancel"),
      onConfirm: () => void removeDevice(device.id),
    });
  }

  async function removeDevice(deviceId: string) {
    if (!businessId) return;
    try {
      await removeRedemptionDevice(businessId, deviceId);
      await reloadDevices();
      setBanner({ message: t("redemptionMode.deviceRemoved", { defaultValue: "Device removed." }), tone: "success" });
    } catch (err) {
      setBanner({
        message: err instanceof Error ? err.message : t("redemptionMode.deviceUpdateFailed", { defaultValue: "Could not update device." }),
        tone: "error",
      });
    }
  }

  if (!businessId) return null;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: Radii.lg,
        padding: Spacing.md,
        backgroundColor: theme.surface,
        gap: Spacing.md,
      }}
    >
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: Spacing.md }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontWeight: "800", fontSize: 17 }}>
            {t("redemptionMode.settingsTitle", { defaultValue: "Redemption mode" })}
          </Text>
          <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 4, lineHeight: 18 }}>
            {t("redemptionMode.settingsSubtitle", { defaultValue: "Lock this device to staff redemptions only." })}
          </Text>
        </View>
        <Text style={{ color: theme.accentText, fontWeight: "900" }}>{open ? "-" : "+"}</Text>
      </Pressable>

      {open ? (
        <>
          {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

          <View style={{ gap: Spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: "800" }}>
                  {t("redemptionMode.ownerPinTitle", { defaultValue: "Owner redeem PIN" })}
                </Text>
                <Text style={{ color: theme.mutedText, fontSize: 13, marginTop: 3, lineHeight: 18 }}>
                  {t("redemptionMode.ownerPinSubtitle", {
                    defaultValue: "When enabled, only Redeem is available until the owner unlocks the app.",
                  })}
                </Text>
              </View>
              {loadingOwnerSecurity ? (
                <ActivityIndicator color={theme.primary} />
              ) : (
                <Text style={{ color: ownerSecurity?.enabled ? theme.accentText : theme.mutedText, fontWeight: "900", fontSize: 12 }}>
                  {ownerSecurity?.enabled ? t("commonUi.on", { defaultValue: "On" }) : t("commonUi.off", { defaultValue: "Off" })}
                </Text>
              )}
            </View>

            {ownerSecurity?.enabled ? (
              <View style={{ gap: Spacing.sm }}>
                <TextInput
                  value={ownerDisablePin}
                  onChangeText={(value) => setOwnerDisablePin(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("redemptionMode.currentPin", { defaultValue: "Current PIN" })}
                  placeholderTextColor={theme.mutedText}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  editable={!savingOwnerSecurity}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: Radii.md,
                    padding: 12,
                    color: theme.text,
                    backgroundColor: theme.background,
                  }}
                />
                <TextInput
                  value={ownerNewPin}
                  onChangeText={(value) => setOwnerNewPin(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("redemptionMode.newPin", { defaultValue: "New PIN" })}
                  placeholderTextColor={theme.mutedText}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  editable={!savingOwnerSecurity}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: Radii.md,
                    padding: 12,
                    color: theme.text,
                    backgroundColor: theme.background,
                  }}
                />
                <TextInput
                  value={ownerNewPinConfirm}
                  onChangeText={(value) => setOwnerNewPinConfirm(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("redemptionMode.confirmNewPin", { defaultValue: "Confirm new PIN" })}
                  placeholderTextColor={theme.mutedText}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  editable={!savingOwnerSecurity}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: Radii.md,
                    padding: 12,
                    color: theme.text,
                    backgroundColor: theme.background,
                  }}
                />
                <SecondaryButton
                  title={savingOwnerSecurity ? t("commonUi.saving", { defaultValue: "Saving..." }) : t("redemptionMode.changeOwnerPin", { defaultValue: "Change owner PIN" })}
                  onPress={() => void changeOwnerPin()}
                  disabled={savingOwnerSecurity || loadingOwnerSecurity}
                  style={{ minHeight: 48, paddingVertical: 10 }}
                />
                <SecondaryButton
                  title={savingOwnerSecurity ? t("commonUi.saving", { defaultValue: "Saving..." }) : t("redemptionMode.disableOwnerPin", { defaultValue: "Turn off owner PIN" })}
                  onPress={() => void disableOwnerPin()}
                  disabled={savingOwnerSecurity || loadingOwnerSecurity}
                  style={{ minHeight: 48, paddingVertical: 10 }}
                />
              </View>
            ) : (
              <View style={{ gap: Spacing.sm }}>
                <TextInput
                  value={ownerPin}
                  onChangeText={(value) => setOwnerPin(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("redemptionMode.ownerPinPlaceholder", { defaultValue: "Redemption PIN" })}
                  placeholderTextColor={theme.mutedText}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  editable={!savingOwnerSecurity}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: Radii.md,
                    padding: 12,
                    color: theme.text,
                    backgroundColor: theme.background,
                  }}
                />
                <TextInput
                  value={ownerPinConfirm}
                  onChangeText={(value) => setOwnerPinConfirm(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={t("redemptionMode.confirmPin", { defaultValue: "Confirm PIN" })}
                  placeholderTextColor={theme.mutedText}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  editable={!savingOwnerSecurity}
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: Radii.md,
                    padding: 12,
                    color: theme.text,
                    backgroundColor: theme.background,
                  }}
                />
                <SecondaryButton
                  title={savingOwnerSecurity ? t("commonUi.saving", { defaultValue: "Saving..." }) : t("redemptionMode.enableOwnerPin", { defaultValue: "Require PIN to unlock business app" })}
                  onPress={() => void enableOwnerPin()}
                  disabled={savingOwnerSecurity || loadingOwnerSecurity}
                  style={{ minHeight: 48, paddingVertical: 10 }}
                />
              </View>
            )}
          </View>

          <View style={{ height: 1, backgroundColor: theme.border }} />

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ color: theme.text, fontWeight: "700" }}>
              {t("redemptionMode.deviceLabel", { defaultValue: "Device label" })}
            </Text>
            <TextInput
              value={deviceLabel}
              onChangeText={setDeviceLabel}
              placeholder={t("redemptionMode.deviceLabelPlaceholder", { defaultValue: "Front counter iPad" })}
              placeholderTextColor={theme.mutedText}
              autoCapitalize="words"
              maxLength={80}
              editable={!activating}
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.md,
                padding: 12,
                color: theme.text,
                backgroundColor: theme.background,
              }}
            />
          </View>

          <View style={{ gap: Spacing.sm }}>
            <Text style={{ color: theme.text, fontWeight: "700" }}>
              {t("redemptionMode.exitPin", { defaultValue: "Exit PIN" })}
            </Text>
            <TextInput
              value={pin}
              onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))}
              placeholder="1234"
              placeholderTextColor={theme.mutedText}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              editable={!activating}
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.md,
                padding: 12,
                color: theme.text,
                backgroundColor: theme.background,
              }}
            />
            <TextInput
              value={pinConfirm}
              onChangeText={(value) => setPinConfirm(value.replace(/\D/g, "").slice(0, 6))}
              placeholder={t("redemptionMode.confirmPin", { defaultValue: "Confirm PIN" })}
              placeholderTextColor={theme.mutedText}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              editable={!activating}
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: Radii.md,
                padding: 12,
                color: theme.text,
                backgroundColor: theme.background,
              }}
            />
          </View>

          <PrimaryButton
            title={activating ? t("redemptionMode.activating", { defaultValue: "Activating..." }) : t("redemptionMode.activate", { defaultValue: "Activate on this device" })}
            onPress={() => void startRedemptionMode()}
            disabled={activating}
          />

          <View style={{ height: 1, backgroundColor: theme.border }} />

          <View style={{ gap: Spacing.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: theme.text, fontWeight: "800" }}>
                {t("redemptionMode.manageDevices", { defaultValue: "Manage devices" })}
              </Text>
              {loadingDevices ? <ActivityIndicator color={theme.primary} /> : null}
            </View>
            {devices.length === 0 && !loadingDevices ? (
              <Text style={{ color: theme.mutedText, fontSize: 13 }}>
                {t("redemptionMode.noDevices", { defaultValue: "No redemption devices yet." })}
              </Text>
            ) : null}
            {devices.map((device) => (
              <View
                key={device.id}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: Radii.md,
                  padding: Spacing.md,
                  gap: Spacing.sm,
                  backgroundColor: theme.background,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: Spacing.md }}>
                  <Text style={{ color: theme.text, fontWeight: "800", flex: 1 }} numberOfLines={1}>
                    {device.device_label}
                  </Text>
                  <Text style={{ color: device.active ? theme.accentText : theme.mutedText, fontWeight: "800", fontSize: 12 }}>
                    {formatDeviceStatus(device, t)}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: Spacing.sm }}>
                  <SecondaryButton
                    title={t("redemptionMode.deactivateDevice", { defaultValue: "Deactivate" })}
                    onPress={() => void deactivateDevice(device.id)}
                    disabled={!device.active}
                    style={{ flex: 1, minHeight: 46, paddingVertical: 8 }}
                  />
                  <SecondaryButton
                    title={t("redemptionMode.removeDevice", { defaultValue: "Remove" })}
                    onPress={() => confirmRemoveDevice(device)}
                    style={{ flex: 1, minHeight: 46, paddingVertical: 8 }}
                  />
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {confirmModal}
    </View>
  );
}
