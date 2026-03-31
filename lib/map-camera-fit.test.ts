import { describe, expect, it } from "vitest";

import { buildMapCameraFitSignature } from "./map-camera-fit";

describe("buildMapCameraFitSignature", () => {
  it("changes when user position changes", () => {
    const a = buildMapCameraFitSignature({
      userPos: { lat: 32.77, lng: -96.79 },
      markers: [{ id: "a", lat: 32.78, lng: -96.8 }],
    });
    const b = buildMapCameraFitSignature({
      userPos: { lat: 32.79, lng: -96.79 },
      markers: [{ id: "a", lat: 32.78, lng: -96.8 }],
    });
    expect(a).not.toBe(b);
  });

  it("changes when marker set changes", () => {
    const a = buildMapCameraFitSignature({
      userPos: null,
      markers: [{ id: "a", lat: 32.78, lng: -96.8 }],
    });
    const b = buildMapCameraFitSignature({
      userPos: null,
      markers: [{ id: "b", lat: 32.78, lng: -96.8 }],
    });
    expect(a).not.toBe(b);
  });
});
