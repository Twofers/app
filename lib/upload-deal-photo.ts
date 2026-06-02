import { Platform } from "react-native";
import { File as ExpoFsFile } from "expo-file-system";
import { supabase } from "./supabase";

/**
 * Upload a local image URI to the `deal-photos` bucket and return its storage path.
 *
 * Mirrors the uploader embedded in the full create screen (app/create/ai.tsx) so a
 * deal published from the express flow stores its poster identically. Kept as a
 * standalone helper so both flows share one code path.
 */
export async function uploadDealPhoto(businessId: string, uri: string): Promise<string> {
  const path = `${businessId}/${Date.now()}.jpg`;
  let body: Blob | ArrayBuffer;
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    body = await response.blob();
  } else {
    const b64 = await new ExpoFsFile(uri).base64();
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    body = bytes.buffer;
  }
  const { error } = await supabase.storage
    .from("deal-photos")
    .upload(path, body, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}
