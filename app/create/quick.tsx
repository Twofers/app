import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";

export default function QuickDealScreen() {
  const router = useRouter();
  const { isLoggedIn, businessId, userId, loading } = useBusiness();
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
      setBanner("Create a business first.");
      return;
    }
    if (!canPublish) {
      setBanner("Title is required.");
      return;
    }

    const end = endTime;
    const now = new Date();
    const maxClaimsNum = Number(maxClaims);
    const cutoffNum = Number(cutoffMins);

    if (Number.isNaN(maxClaimsNum) || maxClaimsNum <= 0) {
      setBanner("Max claims must be greater than 0.");
      return;
    }
    if (Number.isNaN(cutoffNum) || cutoffNum < 0) {
      setBanner("Cutoff buffer must be 0 or more.");
      return;
    }
    if (now >= end) {
      setBanner("End time must be in the future.");
      return;
    }
    const durationMinutes = Math.floor((end.getTime() - now.getTime()) / 60000);
    if (cutoffNum >= durationMinutes) {
      setBanner("Cutoff must be less than the deal duration.");
      return;
    }

    setPublishing(true);
    setBanner(null);
    try {
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner("Price must be a number.");
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
      });

      if (error) throw error;
      router.replace("/(tabs)");
    } catch (err: any) {
      setBanner(err?.message ?? "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Quick Deal</Text>
      {banner ? <Banner message={banner} tone="error" /> : null}

      {!isLoggedIn ? (
        <Text style={{ marginTop: 16, opacity: 0.7 }}>Please log in to create deals.</Text>
      ) : loading ? (
        <Text style={{ marginTop: 16, opacity: 0.7 }}>Loading...</Text>
      ) : !businessId ? (
        <Text style={{ marginTop: 16, opacity: 0.7 }}>Create a business first.</Text>
      ) : (
        <View style={{ marginTop: 16, gap: 12 }}>
          <View>
            <Text>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="2-for-1 latte"
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
            <Text>Price (optional)</Text>
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
            <Text>End time</Text>
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
            <Text>Max claims</Text>
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
            <Text>Claim cutoff buffer (minutes)</Text>
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
            title={publishing ? "Publishing..." : "Publish"}
            onPress={publishDeal}
            disabled={publishing || !canPublish}
          />
        </View>
      )}
    </View>
  );
}
