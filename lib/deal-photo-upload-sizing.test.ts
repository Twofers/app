import { describe, expect, it } from "vitest";
import {
  DEAL_PHOTO_UPLOAD_MAX_SIDE,
  resolveDealPhotoUploadCrop,
  resolveDealPhotoUploadResize,
} from "./deal-photo-upload-sizing";

describe("deal photo upload sizing", () => {
  it("crops landscape photos to a centered square", () => {
    expect(resolveDealPhotoUploadCrop({ width: 4032, height: 3024 })).toEqual({
      originX: 504,
      originY: 0,
      width: 3024,
      height: 3024,
    });
  });

  it("crops portrait photos to a centered square", () => {
    expect(resolveDealPhotoUploadCrop({ width: 3024, height: 4032 })).toEqual({
      originX: 0,
      originY: 504,
      width: 3024,
      height: 3024,
    });
  });

  it("does not crop square photos", () => {
    expect(resolveDealPhotoUploadCrop({ width: 3000, height: 3000 })).toBeNull();
  });

  it("does not resize photos already within the upload cap", () => {
    expect(resolveDealPhotoUploadResize({ width: 1200, height: 900 })).toBeNull();
    expect(resolveDealPhotoUploadResize({ width: DEAL_PHOTO_UPLOAD_MAX_SIDE, height: 900 })).toBeNull();
  });

  it("caps large square posters by width and lets the native renderer preserve the square", () => {
    expect(resolveDealPhotoUploadResize({ width: 3000, height: 3000 })).toEqual({ width: DEAL_PHOTO_UPLOAD_MAX_SIDE });
  });

  it("skips resizing when dimensions are unavailable", () => {
    expect(resolveDealPhotoUploadResize({ width: null, height: 4032 })).toBeNull();
    expect(resolveDealPhotoUploadResize({ width: 4032, height: 0 })).toBeNull();
  });
});
