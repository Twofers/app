import { describe, expect, it } from "vitest";
import {
  DEAL_PHOTO_UPLOAD_MAX_SIDE,
  resolveDealPhotoUploadResize,
} from "./deal-photo-upload-sizing";

describe("deal photo upload sizing", () => {
  it("does not resize photos already within the upload cap", () => {
    expect(resolveDealPhotoUploadResize({ width: 1200, height: 900 })).toBeNull();
    expect(resolveDealPhotoUploadResize({ width: DEAL_PHOTO_UPLOAD_MAX_SIDE, height: 900 })).toBeNull();
  });

  it("caps landscape photos by width", () => {
    expect(resolveDealPhotoUploadResize({ width: 4032, height: 3024 })).toEqual({ width: DEAL_PHOTO_UPLOAD_MAX_SIDE });
  });

  it("caps portrait photos by height", () => {
    expect(resolveDealPhotoUploadResize({ width: 3024, height: 4032 })).toEqual({ height: DEAL_PHOTO_UPLOAD_MAX_SIDE });
  });

  it("caps square photos by width and lets the native renderer preserve the square", () => {
    expect(resolveDealPhotoUploadResize({ width: 3000, height: 3000 })).toEqual({ width: DEAL_PHOTO_UPLOAD_MAX_SIDE });
  });

  it("skips resizing when dimensions are unavailable", () => {
    expect(resolveDealPhotoUploadResize({ width: null, height: 4032 })).toBeNull();
    expect(resolveDealPhotoUploadResize({ width: 4032, height: 0 })).toBeNull();
  });
});
