import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";

import astroConfig from "../astro.config.mjs";

type PackageManifest = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const siteRoot = new URL("../", import.meta.url);

describe("site scaffold", () => {
  test("declares the required commands and exact build dependencies", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("package.json", siteRoot), "utf8"),
    ) as PackageManifest;

    expect(manifest.scripts).toMatchObject({
      dev: "astro dev",
      build: "astro build",
      preview: "astro preview",
      check: "astro check",
    });

    for (const dependency of [
      "astro",
      "@astrojs/check",
      "@types/bun",
      "typescript",
    ]) {
      expect(manifest.devDependencies?.[dependency]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  test("targets the static GitHub Pages project path", () => {
    expect(astroConfig).toMatchObject({
      site: "https://matheusbbarni.github.io",
      base: "/Kitten",
      output: "static",
      outDir: "./dist",
    });
  });

  test("reserves the source and public ownership directories", async () => {
    await Promise.all(
      [
        "src/pages",
        "src/components",
        "src/scripts",
        "src/config",
        "public",
      ].map((directory) => access(new URL(`${directory}/`, siteRoot))),
    );
  });
});
