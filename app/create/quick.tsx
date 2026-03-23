import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { assessDealQuality } from "../../lib/deal-quality";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import {
  resolveDealFlowLanguage,
  translateDealQualityBlock,
} from "../../lib/translate-deal-quality";

export default function QuickDealScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { isLoggedIn, businessId, userId, loading, businessPreferredLocale } = useBusiness();
  const dealLang = resolveDealFlowLanguage(businessPreferredLocale, i18n.language);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [endTime, setEndTime] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [maxClaims, setMaxClaims] = useState("50");
  const [cutoffMins, setCutoffMins] = useState("15");
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const canPublish = useMemo(() => title.trim().length > 0, [title]);

  async function publishDeal() {
    if (!userId || !businessId) {
      setBanner(t("createQuick.errCreateBusiness"));
      return;
    }
    if (!canPublish) {
      setBanner(t("createQuick.errTitleRequired"));
      return;
    }

    const end = endTime;
    const now = new Date();
    const maxClaimsNum = Number(maxClaims);
    const cutoffNum = Number(cutoffMins);

    if (Number.isNaN(maxClaimsNum) || maxClaimsNum <= 0) {
      setBanner(t("createQuick.errMaxClaims"));
      return;
    }
    if (Number.isNaN(cutoffNum) || cutoffNum < 0) {
      setBanner(t("createQuick.errCutoff"));
      return;
    }
    if (now >= end) {
      setBanner(t("createQuick.errEndFuture"));
      return;
    }
    const durationMinutes = Math.floor((end.getTime() - now.getTime()) / 60000);
    if (cutoffNum >= durationMinutes) {
      setBanner(t("createQuick.errCutoffDuration"));
      return;
    }

    setPublishing(true);
    setBanner(null);
    try {
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner(t("createQuick.errPriceNumber"));
        return;
      }

      const quality = assessDealQuality({
        title: title.trim(),
        description: null,
        price: priceNum,
      });
      if (quality.blocked) {
        setBanner(translateDealQualityBlock(quality, dealLang));
        return;
      }

      const { error } = await supabase.from("deals").insert({
        business_id: businessId,
        title: title.trim(),
        description: null,
        price: priceNum,
        start_time: now.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: null,
        quality_tier: quality.tier,
      });

      if (error) throw error;
      router.replace("/(tabs)");
    } catch (err: any) {
      setBanner(err?.message ?? t("createQuick.errPublishFailed"));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("createQuick.title")}</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}

      {!isLoggedIn ? (
        <Text style={{ marginTop: 16, opacity: 0.7 }}>{t("createQuick.loginPrompt")}</Text>
      ) : loading ? (
        <Text style={{ marginTop: 16, opacity: 0.7 }}>{t("createQuick.loading")}</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: 16, opacity: 0.7 }}>{t("createQuick.createBusinessFirst")}</Text>
      ) : (
        <View style={{ marginTop: 16, gap: 12 }}>
          <View>
            <Text>{t("createQuick.fieldTitle")}</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={t("createQuick.placeholderTitle")}
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <View>
            <Text>{t("createQuick.fieldPrice")}</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              keyboardType="decimal-pad"
              placeholder="5.99"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <View>
            <Text>{t("createQuick.fieldEndTime")}</Text>
            <Pressable
              onPress={() => setShowEndPicker(true)}
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            >
              <Text>{endTime.toLocaleString()}</Text>
            </Pressable>
            {showEndPicker ? (
              <DateTimePicker
                value={endTime}
                mode="datetime"
                onChange={(_event, date) => {
                  setShowEndPicker(false);
                  if (date) setEndTime(date);
                }}
              />
            ) : null}
          </View>

          <View>
            <Text>{t("createQuick.fieldMaxClaims")}</Text>
            <TextInput
              value={maxClaims}
              onChangeText={setMaxClaims}
              keyboardType="number-pad"
              placeholder="50"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <View>
            <Text>{t("createQuick.fieldCutoff")}</Text>
            <TextInput
              value={cutoffMins}
              onChangeText={setCutoffMins}
              keyboardType="number-pad"
              placeholder="15"
              style={{
                borderWidth: 1,
                borderColor: "#ccc",
                borderRadius: 10,
                padding: 12,
                marginTop: 6,
              }}
            />
          </View>

          <PrimaryButton
            title={publishing ? t("createQuick.publishing") : t("createQuick.publish")}
            onPress={publishDeal}
            disabled={publishing || !canPublish}
          />
        </View>
      )}
    </View>
  );
}
