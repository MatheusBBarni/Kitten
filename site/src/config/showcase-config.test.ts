import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  assertValidShowcaseConfig,
  faq,
  hero,
  installVerificationSource,
  primaryInstallCmd,
  proof,
  repoName,
  repoOwner,
  repositoryUrl,
  requirements,
  showcaseConfig,
  validateShowcaseConfig,
  verifiedInstallRoutes,
  type ShowcaseConfig,
} from "./showcase-config.ts";

function withConfig(
  overrides: Partial<ShowcaseConfig>,
): ShowcaseConfig {
  return { ...showcaseConfig, ...overrides };
}

describe("showcase config", () => {
  test("defines one non-empty primary verified install route", () => {
    const routes = verifiedInstallRoutes(showcaseConfig);

    expect(primaryInstallCmd.trim()).not.toBe("");
    expect(showcaseConfig.install.primaryInstallCmd).toBe(primaryInstallCmd);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      command: primaryInstallCmd,
      source: installVerificationSource,
    });
    expect(
      showcaseConfig.install.commands.filter(
        ({ source }) => source === "verified-route",
      ),
    ).toHaveLength(1);
  });

  test("exposes non-empty repository metadata and resilient star copy", () => {
    expect(repoOwner.trim()).not.toBe("");
    expect(repoName.trim()).not.toBe("");
    expect(showcaseConfig.repository).toMatchObject({
      owner: repoOwner,
      name: repoName,
      url: repositoryUrl,
    });
    expect(showcaseConfig.repository.star.loadingText.trim()).not.toBe("");
    expect(showcaseConfig.repository.star.fallbackText).not.toContain("0");
    expect(showcaseConfig.repository.star.accessibleLabel.trim()).not.toBe("");
  });

  test("exports config-backed section values and safe proof defaults", () => {
    expect({ hero, proof, requirements, faq }).toEqual({
      hero: showcaseConfig.hero,
      proof: showcaseConfig.proof,
      requirements: showcaseConfig.requirements,
      faq: showcaseConfig.faq,
    });
    expect(proof.videoUrl).toBeNull();
    expect(proof.posterUrl).toBeNull();
    expect(proof.fallbackLabel.trim()).not.toBe("");
    expect(proof.accessibleDescription.trim()).not.toBe("");
  });

  test("rejects missing or conflicting install routes", () => {
    const noRoutes = withConfig({
      install: { ...showcaseConfig.install, commands: [] },
    });
    const twoRoutes = withConfig({
      install: {
        ...showcaseConfig.install,
        commands: [
          ...showcaseConfig.install.commands,
          {
            ...showcaseConfig.install.commands[0]!,
            command: "bun run another-route",
          },
        ],
      },
    });
    const mismatchedPrimary = withConfig({
      install: {
        ...showcaseConfig.install,
        primaryInstallCmd: "bun run mismatched-route",
      },
    });

    expect(validateShowcaseConfig(noRoutes)).toContain(
      "install.commands must contain exactly one verified route.",
    );
    expect(validateShowcaseConfig(twoRoutes)).toContain(
      "install.commands must contain exactly one verified route.",
    );
    expect(validateShowcaseConfig(mismatchedPrimary)).toContain(
      "install.primaryInstallCmd must match the sole verified route command.",
    );
  });

  test("rejects empty, placeholder, and incomplete required content", () => {
    const invalidConfig = withConfig({
      hero: { ...showcaseConfig.hero, heading: " " },
      proof: { ...showcaseConfig.proof, steps: [] },
      install: {
        ...showcaseConfig.install,
        primaryInstallCmd:
          "git clone https://github.com/OWNER/kitten.git",
        commands: [
          {
            ...showcaseConfig.install.commands[0]!,
            command: "git clone https://github.com/OWNER/kitten.git",
          },
        ],
      },
      requirements: { ...showcaseConfig.requirements, items: [] },
      faq: { ...showcaseConfig.faq, items: [] },
      repository: {
        ...showcaseConfig.repository,
        owner: "",
        url: "https://github.com/wrong/repository",
      },
    });
    const errors = validateShowcaseConfig(invalidConfig);

    expect(errors).toEqual(
      expect.arrayContaining([
        "hero.heading must be non-empty.",
        "repository.owner must be non-empty.",
        "install.primaryInstallCmd must not contain placeholders.",
        "repository.url must be derived from owner and name.",
        "proof.steps must contain at least one proof cue.",
        "requirements.items must contain at least one requirement.",
        "faq.items must contain at least one answer.",
      ]),
    );
    expect(() => assertValidShowcaseConfig(invalidConfig)).toThrow(
      "Invalid showcase config",
    );
  });

  test("rejects incomplete verified-route metadata", () => {
    const invalidRoute = withConfig({
      install: {
        ...showcaseConfig.install,
        commands: [
          {
            ...showcaseConfig.install.commands[0]!,
            shellCopyHint: "",
            verificationReference: " ",
          },
        ],
      },
    });

    expect(validateShowcaseConfig(invalidRoute)).toEqual(
      expect.arrayContaining([
        "install.commands[0].shellCopyHint must be non-empty.",
        "install.commands[0].verificationReference must be non-empty.",
      ]),
    );
  });

  test("keeps the Astro route on the config import seam", async () => {
    const pageSource = await readFile(
      new URL("../pages/index.astro", import.meta.url),
      "utf8",
    );

    expect(pageSource).toContain('from "../config/showcase-config.ts"');
    expect(pageSource).toContain("assertValidShowcaseConfig(showcaseConfig)");
    expect(pageSource).not.toContain(primaryInstallCmd);
    expect(pageSource).not.toContain(showcaseConfig.repository.url);
  });
});
