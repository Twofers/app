import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useBusiness } from "../../hooks/use-business";
import { Banner } from "../../components/ui/banner";
import { PrimaryButton } from "../../components/ui/primary-button";
import { SecondaryButton } from "../../components/ui/secondary-button";
import { parseFunctionError } from "../../lib/functions";

type TemplateRow = {
  id: string;
  title: string | null;
  description: string | null;
  price: number | null;
  poster_url: string | null;
  max_claims: number;
  claim_cutoff_buffer_minutes: number;
  is_recurring: boolean;
  days_of_week: number[] | null;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
};

const dayOptions = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 7 },
];

function minutesFromDate(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export default function AiDealScreen() {
  const router = useRouter();
  const { templateId } = useLocalSearchParams<{ templateId?: string }>();
  const { isLoggedIn, businessId, businessName } = useBusiness();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [hintText, setHintText] = useState("");
  const [price, setPrice] = useState("");
  const [title, setTitle] = useState("");
  const [promoLine, setPromoLine] = useState("");
  const [description, setDescription] = useState("");
  const [maxClaims, setMaxClaims] = useState("50");
  const [cutoffMins, setCutoffMins] = useState("15");
  const [validityMode, setValidityMode] = useState<"one-time" | "recurring">("one-time");
  const [startTime, setStartTime] = useState(new Date());
  const [endTime, setEndTime] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showWindowStartPicker, setShowWindowStartPicker] = useState(false);
  const [showWindowEndPicker, setShowWindowEndPicker] = useState(false);
  const [windowStart, setWindowStart] = useState(new Date());
  const [windowEnd, setWindowEnd] = useState(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"
  );
  const [banner, setBanner] = useState<{ message: string; tone?: "error" | "success" | "info" } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [templateLoaded, setTemplateLoaded] = useState(false);

  const canPublish = useMemo(() => {
    return title.trim().length > 0 && description.trim().length > 0;
  }, [title, description]);

  useEffect(() => {
    if (!templateId || !businessId) return;
    (async () => {
      const { data, error } = await supabase
        .from("deal_templates")
        .select("*")
        .eq("id", templateId)
        .eq("business_id", businessId)
        .single();
      if (!error && data) {
        const t = data as TemplateRow;
        setTitle(t.title ?? "");
        setDescription(t.description ?? "");
        setPrice(t.price != null ? String(t.price) : "");
        setPosterUrl(t.poster_url ?? null);
        setMaxClaims(String(t.max_claims ?? 50));
        setCutoffMins(String(t.claim_cutoff_buffer_minutes ?? 15));
        setValidityMode(t.is_recurring ? "recurring" : "one-time");
        setDaysOfWeek(t.days_of_week ?? [1, 2, 3, 4, 5]);
        if (t.window_start_minutes != null) {
          const d = new Date();
          d.setHours(Math.floor(t.window_start_minutes / 60), t.window_start_minutes % 60, 0, 0);
          setWindowStart(d);
        }
        if (t.window_end_minutes != null) {
          const d = new Date();
          d.setHours(Math.floor(t.window_end_minutes / 60), t.window_end_minutes % 60, 0, 0);
          setWindowEnd(d);
        }
        setTemplateLoaded(true);
      }
    })();
  }, [templateId, businessId]);

  async function pickPhotoFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setBanner({ message: "Please allow photo access.", tone: "error" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setPhotoUri(result.assets[0].uri);
    setPosterUrl(null);
    setPhotoPath(null);
  }

  async function takePhoto() {
    const perm = permission?.status === "granted" ? permission : await requestPermission();
    if (!perm?.granted) {
      setBanner({ message: "Camera permission is required.", tone: "error" });
      return;
    }
    setShowCamera(true);
  }

  async function capturePhoto() {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
    if (photo?.uri) {
      setPhotoUri(photo.uri);
      setPosterUrl(null);
      setPhotoPath(null);
      setShowCamera(false);
    }
  }

  function validateInputs(forGenerate: boolean) {
    const maxClaimsNum = Number(maxClaims);
    const cutoffNum = Number(cutoffMins);
    if (Number.isNaN(maxClaimsNum) || maxClaimsNum <= 0) {
      setBanner({ message: "Max claims must be greater than 0.", tone: "error" });
      return false;
    }
    if (Number.isNaN(cutoffNum) || cutoffNum < 0) {
      setBanner({ message: "Cutoff buffer must be 0 or more.", tone: "error" });
      return false;
    }
    if (validityMode === "one-time") {
      if (endTime <= startTime) {
        setBanner({ message: "End time must be after start time.", tone: "error" });
        return false;
      }
    } else {
      if (daysOfWeek.length === 0) {
        setBanner({ message: "Select at least one day for recurring deals.", tone: "error" });
        return false;
      }
      if (minutesFromDate(windowStart) >= minutesFromDate(windowEnd)) {
        setBanner({ message: "Recurring window start must be before end.", tone: "error" });
        return false;
      }
    }
    if (forGenerate) {
      if (!photoUri && !posterUrl) {
        setBanner({ message: "Please add a photo.", tone: "error" });
        return false;
      }
      if (!hintText.trim()) {
        setBanner({ message: "Please add a few words about the deal.", tone: "error" });
        return false;
      }
    }
    return true;
  }

  async function ensureUploadedPhoto() {
    if (photoPath) return photoPath;
    if (!photoUri || !businessId) return null;
    const path = `${businessId}/${Date.now()}.jpg`;
    const response = await fetch(photoUri);
    const blob = await response.blob();
    const { error: uploadError } = await supabase.storage
      .from("deal-photos")
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw uploadError;
    setPhotoPath(path);
    return path;
  }

  async function ensurePosterUrl(path: string | null) {
    if (posterUrl) return posterUrl;
    if (!path) return null;
    const { data, error } = await supabase.storage
      .from("deal-photos")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (error) throw error;
    setPosterUrl(data?.signedUrl ?? null);
    return data?.signedUrl ?? null;
  }

  async function generateCopy() {
    if (!validateInputs(true)) return;
    setGenerating(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      const { data, error } = await supabase.functions.invoke("ai-generate-deal-copy", {
        body: {
          hint_text: hintText.trim(),
          price: priceNum,
          business_name: businessName ?? "Local business",
        },
      });
      if (error) {
        throw new Error(parseFunctionError(error));
      }
      setTitle(data.title ?? "");
      setPromoLine(data.promo_line ?? "");
      setDescription(data.description ?? "");
    } catch (err: any) {
      setBanner({ message: err?.message ?? "AI generation failed.", tone: "error" });
    } finally {
      setGenerating(false);
    }
  }

  async function publishDeal() {
    if (!validateInputs(false)) return;
    if (!businessId) {
      setBanner({ message: "Create a business first.", tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: "Please generate or enter title and description.", tone: "error" });
      return;
    }
    setPublishing(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: "Price must be a number.", tone: "error" });
        return;
      }
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const isRecurring = validityMode === "recurring";
      const start = isRecurring ? new Date() : startTime;
      const end = isRecurring ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : endTime;

      const { error } = await supabase.from("deals").insert({
        business_id: businessId,
        title: title.trim(),
        description: description.trim(),
        price: priceNum,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        claim_cutoff_buffer_minutes: cutoffNum,
        max_claims: maxClaimsNum,
        is_active: true,
        poster_url: signedPoster,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
        timezone: isRecurring ? timezone : null,
      });
      if (error) throw error;
      router.replace("/(tabs)");
    } catch (err: any) {
      setBanner({ message: err?.message ?? "Publish failed.", tone: "error" });
    } finally {
      setPublishing(false);
    }
  }

  async function saveTemplate() {
    if (!businessId) {
      setBanner({ message: "Create a business first.", tone: "error" });
      return;
    }
    if (!canPublish) {
      setBanner({ message: "Please generate or enter title and description first.", tone: "error" });
      return;
    }
    setSavingTemplate(true);
    setBanner(null);
    try {
      const path = await ensureUploadedPhoto();
      const signedPoster = await ensurePosterUrl(path);
      const priceNum = price.trim() ? Number(price) : null;
      if (price.trim() && Number.isNaN(priceNum)) {
        setBanner({ message: "Price must be a number.", tone: "error" });
        return;
      }
      const maxClaimsNum = Number(maxClaims);
      const cutoffNum = Number(cutoffMins);
      const isRecurring = validityMode === "recurring";

      const { error } = await supabase.from("deal_templates").insert({
        business_id: businessId,
        title: title.trim(),
        description: description.trim(),
        price: priceNum,
        poster_url: signedPoster,
        max_claims: maxClaimsNum,
        claim_cutoff_buffer_minutes: cutoffNum,
        is_recurring: isRecurring,
        days_of_week: isRecurring ? daysOfWeek : null,
        window_start_minutes: isRecurring ? minutesFromDate(windowStart) : null,
        window_end_minutes: isRecurring ? minutesFromDate(windowEnd) : null,
      });
      if (error) throw error;
      setBanner({ message: "Template saved.", tone: "success" });
    } catch (err: any) {
      setBanner({ message: err?.message ?? "Saving template failed.", tone: "error" });
    } finally {
      setSavingTemplate(false);
    }
  }

  const validitySummary =
    validityMode === "one-time"
      ? `${startTime.toLocaleString()} → ${endTime.toLocaleString()}`
      : `${dayOptions.filter((d) => daysOfWeek.includes(d.value)).map((d) => d.label).join(", ")} · ${formatMinutes(minutesFromDate(windowStart))}–${formatMinutes(minutesFromDate(windowEnd))} (${timezone})`;

  if (!isLoggedIn) {
    return (
      <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>AI Deal</Text>
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Please log in to create deals.</Text>
      </View>
    );
  }

  if (!businessId) {
    return (
      <View style={{ paddingTop: 70, paddingHorizontal: 16, flex: 1 }}>
        <Text style={{ fontSize: 22, fontWeight: "700" }}>AI Deal</Text>
        <Text style={{ marginTop: 12, opacity: 0.7 }}>Create a business to use AI Deal.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 70, paddingHorizontal: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>AI Deal</Text>
      {banner ? <Banner message={banner.message} tone={banner.tone} /> : null}

      {showCamera ? (
        <View style={{ marginTop: 16, borderRadius: 16, overflow: "hidden" }}>
          <CameraView ref={cameraRef} style={{ height: 360, width: "100%" }} facing="back" />
          <View style={{ padding: 12, backgroundColor: "#111" }}>
            <PrimaryButton title="Capture Photo" onPress={capturePhoto} />
            <View style={{ marginTop: 8 }}>
              <SecondaryButton title="Cancel" onPress={() => setShowCamera(false)} />
            </View>
          </View>
        </View>
      ) : (
        <>
          <Text style={{ marginTop: 16, fontWeight: "700" }}>Photo</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <PrimaryButton title="Take Photo" onPress={takePhoto} />
            <SecondaryButton title="Pick Photo" onPress={pickPhotoFromLibrary} />
          </View>

          {photoUri || posterUrl ? (
            <Image
              source={{ uri: photoUri ?? posterUrl ?? "" }}
              style={{ height: 200, width: "100%", borderRadius: 16, marginTop: 12 }}
              contentFit="cover"
            />
          ) : (
            <View style={{ height: 200, borderRadius: 16, marginTop: 12, backgroundColor: "#eee" }} />
          )}

          <Text style={{ marginTop: 16 }}>A few words</Text>
          <TextInput
            value={hintText}
            onChangeText={setHintText}
            placeholder="2-for-1 latte, today only"
            style={{
              borderWidth: 1,
              borderColor: "#ccc",
              borderRadius: 10,
              padding: 12,
              marginTop: 6,
            }}
          />

          <Text style={{ marginTop: 12 }}>Price (optional)</Text>
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

          <Text style={{ marginTop: 12, fontWeight: "700" }}>Validity</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={() => setValidityMode("one-time")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: validityMode === "one-time" ? "#111" : "#eee",
              }}
            >
              <Text style={{ color: validityMode === "one-time" ? "#fff" : "#111", fontWeight: "700" }}>
                One-time
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setValidityMode("recurring")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 999,
                backgroundColor: validityMode === "recurring" ? "#111" : "#eee",
              }}
            >
              <Text style={{ color: validityMode === "recurring" ? "#fff" : "#111", fontWeight: "700" }}>
                Recurring
              </Text>
            </Pressable>
          </View>

          {validityMode === "one-time" ? (
            <>
              <Text style={{ marginTop: 12 }}>Start time</Text>
              <Pressable
                onPress={() => setShowStartPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              >
                <Text>{startTime.toLocaleString()}</Text>
              </Pressable>
              {showStartPicker ? (
                <DateTimePicker
                  value={startTime}
                  mode="datetime"
                  onChange={(_event, date) => {
                    setShowStartPicker(false);
                    if (date) setStartTime(date);
                  }}
                />
              ) : null}

              <Text style={{ marginTop: 12 }}>End time</Text>
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
            </>
          ) : (
            <>
              <Text style={{ marginTop: 12 }}>Days</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {dayOptions.map((day) => {
                  const selected = daysOfWeek.includes(day.value);
                  return (
                    <Pressable
                      key={day.value}
                      onPress={() => {
                        setDaysOfWeek((prev) =>
                          selected ? prev.filter((d) => d !== day.value) : [...prev, day.value]
                        );
                      }}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        backgroundColor: selected ? "#111" : "#eee",
                      }}
                    >
                      <Text style={{ color: selected ? "#fff" : "#111", fontWeight: "600" }}>
                        {day.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={{ marginTop: 12 }}>Time window</Text>
              <Pressable
                onPress={() => setShowWindowStartPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              >
                <Text>Start: {formatMinutes(minutesFromDate(windowStart))}</Text>
              </Pressable>
              {showWindowStartPicker ? (
                <DateTimePicker
                  value={windowStart}
                  mode="time"
                  onChange={(_event, date) => {
                    setShowWindowStartPicker(false);
                    if (date) setWindowStart(date);
                  }}
                />
              ) : null}

              <Pressable
                onPress={() => setShowWindowEndPicker(true)}
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              >
                <Text>End: {formatMinutes(minutesFromDate(windowEnd))}</Text>
              </Pressable>
              {showWindowEndPicker ? (
                <DateTimePicker
                  value={windowEnd}
                  mode="time"
                  onChange={(_event, date) => {
                    setShowWindowEndPicker(false);
                    if (date) setWindowEnd(date);
                  }}
                />
              ) : null}
            </>
          )}

          <Text style={{ marginTop: 12 }}>Max claims</Text>
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

          <Text style={{ marginTop: 12 }}>Claim cutoff buffer (minutes)</Text>
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

          <View style={{ marginTop: 16 }}>
            <PrimaryButton title={generating ? "Generating..." : "Generate"} onPress={generateCopy} disabled={generating} />
          </View>

          {(title.trim() || description.trim() || templateLoaded) ? (
            <>
              <Text style={{ marginTop: 18, fontWeight: "700" }}>Preview</Text>
              <View
                style={{
                  borderRadius: 18,
                  backgroundColor: "#fff",
                  overflow: "hidden",
                  marginTop: 10,
                  shadowColor: "#000",
                  shadowOpacity: 0.08,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 2,
                }}
              >
                {photoUri || posterUrl ? (
                  <Image
                    source={{ uri: photoUri ?? posterUrl ?? "" }}
                    style={{ height: 200, width: "100%" }}
                    contentFit="cover"
                  />
                ) : (
                  <View style={{ height: 200, backgroundColor: "#eee" }} />
                )}
                <View style={{ padding: 12 }}>
                  <Text style={{ fontSize: 16, fontWeight: "700" }}>{title || "Deal title"}</Text>
                  {promoLine ? (
                    <Text style={{ marginTop: 6, fontWeight: "600" }}>{promoLine}</Text>
                  ) : null}
                  <Text style={{ marginTop: 6, opacity: 0.8 }}>{description || "Short description"}</Text>
                  <Text style={{ marginTop: 8, opacity: 0.7 }}>Validity: {validitySummary}</Text>
                  <Text style={{ marginTop: 4, opacity: 0.7 }}>Max claims: {maxClaims}</Text>
                </View>
              </View>

              <Text style={{ marginTop: 16 }}>Edit title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Title"
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>Edit promo line</Text>
              <TextInput
                value={promoLine}
                onChangeText={setPromoLine}
                placeholder="Promo line"
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                }}
              />
              <Text style={{ marginTop: 12 }}>Edit description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Description"
                multiline
                style={{
                  borderWidth: 1,
                  borderColor: "#ccc",
                  borderRadius: 10,
                  padding: 12,
                  marginTop: 6,
                  minHeight: 90,
                }}
              />

              <View style={{ marginTop: 16, gap: 8 }}>
                <PrimaryButton title={publishing ? "Publishing..." : "Publish Deal"} onPress={publishDeal} disabled={publishing} />
                <SecondaryButton
                  title={savingTemplate ? "Saving..." : "Save as Template"}
                  onPress={saveTemplate}
                  disabled={savingTemplate}
                />
              </View>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
