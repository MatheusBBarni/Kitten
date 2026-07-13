export type ProofMotionPreference = "standard" | "reduced";

export type ProofMediaState = {
  readonly motionPreference: ProofMotionPreference;
  readonly preload: "metadata" | "none";
  readonly pausePlayback: boolean;
  readonly showMotionNote: boolean;
};

export function proofMediaState(
  prefersReducedMotion: boolean,
): ProofMediaState {
  if (prefersReducedMotion) {
    return {
      motionPreference: "reduced",
      preload: "none",
      pausePlayback: true,
      showMotionNote: true,
    };
  }

  return {
    motionPreference: "standard",
    preload: "metadata",
    pausePlayback: false,
    showMotionNote: false,
  };
}
