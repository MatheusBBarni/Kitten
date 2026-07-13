import { proofMediaState } from "./proof-media-state.ts";

const proofMediaSelector = "[data-proof-media]";
const proofVideoSelector = "[data-proof-video]";
const motionNoteSelector = "[data-proof-motion-note]";
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export function applyProofMotionPreference(
  root: ParentNode,
  prefersReducedMotion: boolean,
): number {
  const state = proofMediaState(prefersReducedMotion);
  let updatedMedia = 0;

  for (const media of root.querySelectorAll<HTMLElement>(proofMediaSelector)) {
    media.dataset.motionPreference = state.motionPreference;

    const video = media.querySelector<HTMLVideoElement>(proofVideoSelector);
    const motionNote = media.querySelector<HTMLElement>(motionNoteSelector);

    if (motionNote) {
      motionNote.hidden = !video || !state.showMotionNote;
    }

    if (video) {
      video.autoplay = false;
      video.removeAttribute("autoplay");
      video.preload = state.preload;

      if (state.pausePlayback) {
        video.pause();
      }
    }

    updatedMedia += 1;
  }

  return updatedMedia;
}

export function bindProofMotionPreference(root: ParentNode = document): void {
  const preference = window.matchMedia(reducedMotionQuery);
  const applyPreference = (): void => {
    applyProofMotionPreference(root, preference.matches);
  };

  applyPreference();
  preference.addEventListener("change", applyPreference);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  bindProofMotionPreference(document);
}
