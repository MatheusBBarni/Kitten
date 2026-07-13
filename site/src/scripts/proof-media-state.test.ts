import { describe, expect, test } from "bun:test";

import { proofMediaState } from "./proof-media-state.ts";

describe("proof media state", () => {
  test("keeps standard playback opt-in while allowing metadata preload", () => {
    expect(proofMediaState(false)).toEqual({
      motionPreference: "standard",
      preload: "metadata",
      pausePlayback: false,
      showMotionNote: false,
    });
  });

  test("stops eager loading and pauses playback for reduced motion", () => {
    expect(proofMediaState(true)).toEqual({
      motionPreference: "reduced",
      preload: "none",
      pausePlayback: true,
      showMotionNote: true,
    });
  });
});
