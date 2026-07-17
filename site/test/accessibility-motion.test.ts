import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { showcaseConfig } from "../src/config/showcase-config.ts";

const siteRoot = new URL("../", import.meta.url);
let renderedHtml = "";
let stylesheet = "";

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function hexChannels(hex: string): readonly [number, number, number] {
  const normalized = hex.replace("#", "");
  return [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  ) as unknown as readonly [number, number, number];
}

function relativeLuminance(hex: string): number {
  const channels = hexChannels(hex).map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return (
    0.2126 * (channels[0] ?? 0) +
    0.7152 * (channels[1] ?? 0) +
    0.0722 * (channels[2] ?? 0)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

beforeAll(async () => {
  const build = Bun.spawn(["bun", "run", "build"], {
    cwd: fileURLToPath(siteRoot),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);

  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  [renderedHtml, stylesheet] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/site.css", import.meta.url), "utf8"),
  ]);
});

describe("showcase accessibility and motion", () => {
  test("keeps semantic landmarks and heading order stable", () => {
    expect(occurrences(renderedHtml, "<main")).toBe(1);
    expect(occurrences(renderedHtml, "<h1")).toBe(1);
    expect(occurrences(renderedHtml, "<h2")).toBe(4);

    const sectionOffsets = [
      showcaseConfig.hero.id,
      showcaseConfig.proof.id,
      showcaseConfig.install.id,
      showcaseConfig.requirements.id,
      showcaseConfig.faq.id,
    ].map((id) => renderedHtml.indexOf(`id="${id}"`));

    expect(sectionOffsets.every((offset) => offset >= 0)).toBe(true);
    expect(sectionOffsets).toEqual(
      [...sectionOffsets].sort((left, right) => left - right),
    );
    expect(renderedHtml).toMatch(
      /aria-selected="false"[^>]*tabindex="-1"[^>]*data-install-tab/,
    );
  });

  test("keeps proof steps visible without placeholder media", () => {
    expect(renderedHtml).toContain(showcaseConfig.proof.accessibleDescription);
    expect(renderedHtml).toContain("data-proof-step");
    expect(renderedHtml).not.toContain("data-proof-media");
    expect(renderedHtml).not.toContain("data-proof-poster");
  });

  test("renders the current provider roster as an accessible list", () => {
    expect(renderedHtml).toContain(
      '<ul class="agent-roster-list" aria-label="Current coding-agent connections available in Kitten." data-agent-roster>',
    );

    for (const provider of showcaseConfig.hero.currentProviders) {
      expect(renderedHtml).toContain(provider);
    }
  });

  test("defines narrow-layout, focus, contrast, and reduced-motion safeguards", () => {
    expect(stylesheet).toContain("min-inline-size: 20rem");
    expect(stylesheet).toContain("overflow-wrap: anywhere");
    expect(stylesheet).toContain(":focus-visible");
    expect(stylesheet).toContain("@media (min-width: 48rem)");
    expect(stylesheet).toContain("@media (prefers-color-scheme: light)");
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(stylesheet).toContain(".docs-code");
    expect(stylesheet).toContain("overflow-x: auto");
    expect(stylesheet).toContain(".docs-topic-nav a");
  });

  test("keeps dark and light text pairs above WCAG AA contrast", () => {
    const contrastPairs = [
      ["#f9fafb", "#0a0e14"],
      ["#b7c1d1", "#121923"],
      ["#17120a", "#ffc83d"],
      ["#171d27", "#f7f8fb"],
      ["#526071", "#ffffff"],
      ["#ffffff", "#855500"],
    ] as const;

    for (const [foreground, background] of contrastPairs) {
      expect(stylesheet).toContain(foreground);
      expect(stylesheet).toContain(background);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("keeps mobile CTA text present and wrapped safely", () => {
    expect(renderedHtml).toContain(showcaseConfig.hero.primaryCtaLabel);
    for (const command of showcaseConfig.install.commands) {
      expect(renderedHtml).toContain(command.copyCtaLabel);
    }
    expect(stylesheet).toMatch(/\.button\s*\{[^}]*overflow-wrap: anywhere/s);
    expect(stylesheet).toMatch(
      /\.install-command pre\s*\{[^}]*max-inline-size: 100%/s,
    );
  });
});
