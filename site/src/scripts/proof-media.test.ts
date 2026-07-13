import { describe, expect, test } from "bun:test";

import {
  applyProofMotionPreference,
  bindProofMotionPreference,
} from "./proof-media.ts";

type FakeVideo = {
  autoplay: boolean;
  controls: boolean;
  preload: string;
  pauseCalls: number;
  removedAttributes: string[];
  pause(): void;
  removeAttribute(name: string): void;
};

function proofFixture(withVideo = true): {
  readonly root: ParentNode;
  readonly media: { dataset: DOMStringMap };
  readonly note: { hidden: boolean };
  readonly video: FakeVideo | null;
} {
  const video: FakeVideo | null = withVideo
    ? {
        autoplay: true,
        controls: true,
        preload: "none",
        pauseCalls: 0,
        removedAttributes: [],
        pause() {
          this.pauseCalls += 1;
        },
        removeAttribute(name: string) {
          this.removedAttributes.push(name);
        },
      }
    : null;
  const note = { hidden: true };
  const media = {
    dataset: {} as DOMStringMap,
    querySelector(selector: string) {
      if (selector === "[data-proof-video]") return video;
      if (selector === "[data-proof-motion-note]") return note;
      return null;
    },
  };
  const root = {
    querySelectorAll(selector: string) {
      return selector === "[data-proof-media]" ? [media] : [];
    },
  };

  return {
    root: root as unknown as ParentNode,
    media,
    note,
    video,
  };
}

describe("proof media motion binding", () => {
  test("keeps controls opt-in and loads metadata in standard mode", () => {
    const fixture = proofFixture();

    expect(applyProofMotionPreference(fixture.root, false)).toBe(1);
    expect(fixture.media.dataset.motionPreference).toBe("standard");
    expect(fixture.video).toMatchObject({
      autoplay: false,
      controls: true,
      preload: "metadata",
      pauseCalls: 0,
      removedAttributes: ["autoplay"],
    });
    expect(fixture.note.hidden).toBe(true);
  });

  test("pauses playback and exposes the reduced-motion note", () => {
    const fixture = proofFixture();

    expect(applyProofMotionPreference(fixture.root, true)).toBe(1);
    expect(fixture.media.dataset.motionPreference).toBe("reduced");
    expect(fixture.video).toMatchObject({
      autoplay: false,
      controls: true,
      preload: "none",
      pauseCalls: 1,
      removedAttributes: ["autoplay"],
    });
    expect(fixture.note.hidden).toBe(false);
  });

  test("keeps the motion note hidden when only the poster fallback exists", () => {
    const fixture = proofFixture(false);

    expect(applyProofMotionPreference(fixture.root, true)).toBe(1);
    expect(fixture.media.dataset.motionPreference).toBe("reduced");
    expect(fixture.note.hidden).toBe(true);
  });

  test("reacts to live preference changes without removing video controls", () => {
    const fixture = proofFixture();
    const listeners: Array<() => void> = [];
    const preference = {
      matches: false,
      addEventListener(event: string, listener: () => void) {
        if (event === "change") listeners.push(listener);
      },
    };
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: () => preference },
    });

    try {
      bindProofMotionPreference(fixture.root);
      expect(fixture.media.dataset.motionPreference).toBe("standard");

      preference.matches = true;
      listeners[0]?.();

      expect(fixture.media.dataset.motionPreference).toBe("reduced");
      expect(fixture.video).toMatchObject({ controls: true, pauseCalls: 1 });
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});
