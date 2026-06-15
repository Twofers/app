import { describe, expect, it } from "vitest";

import { buildMapCameraFitSignature, buildMapFitCoordinates } from "./map-camera-fit";

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

describe("buildMapFitCoordinates", () => {
  it("includes user position and marker positions for native camera fitting", () => {
    expect(buildMapFitCoordinates({
      userPos: { lat: 32.9247, lng: -96.9598 },
      markers: [
        { id: "cedar", lat: 32.9399, lng: -97.0781 },
        { id: "bad", lat: Number.NaN, lng: -97 },
      ],
    })).toEqual([
      { latitude: 32.9247, longitude: -96.9598 },
      { latitude: 32.9399, longitude: -97.0781 },
    ]);
  });

  it("uses only visible markers when there is no user position", () => {
    expect(buildMapFitCoordinates({
      userPos: null,
      markers: [{ id: "shop", lat: 32.9, lng: -97.1 }],
    })).toEqual([{ latitude: 32.9, longitude: -97.1 }]);
  });
});
