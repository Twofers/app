import { Platform } from "react-native";
import { File as ExpoFsFile } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { supabase } from "./supabase";
import {
  DEAL_PHOTO_UPLOAD_JPEG_QUALITY,
  resolveDealPhotoUploadResize,
} from "./deal-photo-upload-sizing";

async function prepareDealPhotoForUpload(uri: string): Promise<string> {
  const source = await ImageManipulator.manipulate(uri).renderAsync();
  const resize = resolveDealPhotoUploadResize({ width: source.width, height: source.height });
  const rendered = resize
    ? await ImageManipulator.manipulate(uri).resize(resize).renderAsync()
    : source;
  const saved = await rendered.saveAsync({
    compress: DEAL_PHOTO_UPLOAD_JPEG_QUALITY,
    format: SaveFormat.JPEG,
    base64: false,
  });
  return saved.uri;
}

/**
 * Upload a local image URI to the `deal-photos` bucket and return its storage path.
 *
 * Mirrors the uploader embedded in the full create screen (app/create/ai.tsx) so a
 * deal published from the express flow stores its poster identically. Kept as a
 * standalone helper so both flows share one code path.
 */
export async function uploadDealPhoto(businessId: string, uri: string): Promise<string> {
  const path = `${businessId}/${Date.now()}.jpg`;
  const uploadUri = await prepareDealPhotoForUpload(uri);
  let body: Blob | ArrayBuffer;
  if (Platform.OS === "web") {
    const response = await fetch(uploadUri);
    body = await response.blob();
  } else {
    const b64 = await new ExpoFsFile(uploadUri).base64();
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
