import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import config from "../electrobun.config.ts";

test("uses the worker-safe desktop entrypoint and the kitten macOS icon set", () => {
  expect(config.build.bun.entrypoint).toBe("src/index.ts");
  expect(config.build.mac?.icons).toBe("assets/kitten-icon.iconset");
  expect(config.build.copy?.["assets/kitten-icon.iconset/icon_128x128.png"]).toBe("views/main/kitten-icon.png");

  for (const filename of [
    "icon_16x16.png",
    "icon_16x16@2x.png",
    "icon_32x32.png",
    "icon_32x32@2x.png",
    "icon_128x128.png",
    "icon_128x128@2x.png",
    "icon_256x256.png",
    "icon_256x256@2x.png",
    "icon_512x512.png",
    "icon_512x512@2x.png",
  ]) {
    expect(existsSync(join(import.meta.dir, "../assets/kitten-icon.iconset", filename))).toBeTrue();
  }
});
