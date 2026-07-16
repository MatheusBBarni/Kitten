import { beforeAll, describe, expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { showcaseConfig } from "../src/config/showcase-config.ts";

const siteRoot = new URL("../", import.meta.url);
const componentRoot = new URL("../src/components/", import.meta.url);
let renderedHtml = "";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
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
  renderedHtml = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
});

describe("showcase landing page", () => {
  test("builds exactly one route with config-driven sections in order", async () => {
    expect(await readdir(new URL("../src/pages/", import.meta.url))).toEqual([
      "index.astro",
    ]);

    const sections = [
      showcaseConfig.hero,
      showcaseConfig.proof,
      showcaseConfig.install,
      showcaseConfig.requirements,
      showcaseConfig.faq,
    ];
    const offsets = sections.map(({ id }) => {
      const marker = `id="${escapeHtml(id)}"`;
      expect(renderedHtml).toContain(marker);
      return renderedHtml.indexOf(marker);
    });

    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
  });

  test("renders the configured heading hierarchy and section copy", () => {
    const sections = [
      showcaseConfig.hero,
      showcaseConfig.proof,
      showcaseConfig.install,
      showcaseConfig.requirements,
      showcaseConfig.faq,
    ];

    expect(renderedHtml.match(/<h1\b/g)).toHaveLength(1);
    expect(renderedHtml.match(/<h2\b/g)).toHaveLength(4);

    for (const { heading, body } of sections) {
      expect(occurrences(renderedHtml, escapeHtml(heading))).toBe(1);
      expect(occurrences(renderedHtml, escapeHtml(body))).toBe(1);
    }
  });

  test("renders proof, install, requirements, FAQ, and repository data from config", () => {
    expect(renderedHtml).toContain(
      escapeHtml(showcaseConfig.install.primaryInstallCmd),
    );
    expect(renderedHtml).toContain(
      `href="${escapeHtml(showcaseConfig.repository.url)}"`,
    );
    expect(renderedHtml).toContain("data-proof-step");
    expect(renderedHtml).not.toContain("data-proof-media");

    for (const command of showcaseConfig.install.commands) {
      expect(renderedHtml).toContain(escapeHtml(command.command));
      expect(renderedHtml).toContain(escapeHtml(command.copyCtaLabel));
      expect(renderedHtml).toContain(
        `data-install-method="${escapeHtml(command.id)}"`,
      );
    }

    for (const step of showcaseConfig.proof.steps) {
      expect(renderedHtml).toContain(escapeHtml(step.description));
    }
    for (const requirement of showcaseConfig.requirements.items) {
      expect(renderedHtml).toContain(escapeHtml(requirement));
    }
    for (const item of showcaseConfig.faq.items) {
      expect(renderedHtml).toContain(escapeHtml(item.question));
      expect(renderedHtml).toContain(escapeHtml(item.answer));
    }
  });

  test("keeps primary actions keyboard-reachable as native controls", () => {
    expect(
      occurrences(renderedHtml, `href="#${showcaseConfig.install.id}"`),
    ).toBe(2);
    expect(renderedHtml).toContain(
      `<a class="button button-primary" href="#${showcaseConfig.install.id}">${escapeHtml(showcaseConfig.hero.primaryCtaLabel)}</a>`,
    );
    expect(renderedHtml).toContain('role="tablist"');
    expect(renderedHtml).toMatch(
      /aria-selected="true"[^>]*tabindex="0"[^>]*data-install-tab/,
    );
    expect(renderedHtml).toMatch(
      /aria-selected="false"[^>]*tabindex="-1"[^>]*data-install-tab/,
    );
    expect(renderedHtml).toMatch(
      /<button\b[^>]*type="button"[^>]*data-copy-command-trigger/,
    );
    expect(renderedHtml).toMatch(
      /data-copy-command-status[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
    );
    expect(renderedHtml).toMatch(/data-copy-command-text[^>]*tabindex="0"/);
    expect(renderedHtml).toContain(
      `aria-label="${escapeHtml(showcaseConfig.repository.star.loadingAccessibleLabel)}"`,
    );
  });

  test("renders a truthful star fallback with config-driven runtime hooks", () => {
    expect(renderedHtml).toContain("data-star-control");
    expect(renderedHtml.indexOf("data-star-control")).toBeLessThan(
      renderedHtml.indexOf("<main"),
    );
    expect(renderedHtml).toContain("github-star-control");
    expect(renderedHtml).toContain("github-star-icon");
    expect(renderedHtml).toContain(
      `data-repo-owner="${escapeHtml(showcaseConfig.repository.owner)}"`,
    );
    expect(renderedHtml).toContain(
      `data-repo-name="${escapeHtml(showcaseConfig.repository.name)}"`,
    );
    expect(renderedHtml).toContain('data-star-status="loading"');
    expect(renderedHtml).toContain("data-star-status-text");
    expect(renderedHtml).toContain(
      escapeHtml(showcaseConfig.repository.star.loadingText),
    );
    expect(renderedHtml).toMatch(
      /data-star-status-text[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/,
    );
    expect(renderedHtml).toContain(
      `href="${escapeHtml(showcaseConfig.repository.url)}"`,
    );
  });

  test("emits the Kitten icon as a compact PNG favicon", async () => {
    const faviconTag = renderedHtml.match(/<link\b[^>]*rel="icon"[^>]*>/)?.[0];

    expect(faviconTag).toBeTruthy();
    expect(faviconTag).toContain('type="image/png"');
    expect(faviconTag).toContain('sizes="64x64"');

    const faviconHref = faviconTag?.match(/href="([^"]+)"/)?.[1];
    expect(faviconHref).toMatch(/^\/Kitten\/_astro\/kitten-icon\..+\.png$/);

    if (!faviconHref) {
      throw new Error("Expected the rendered favicon link to include an href.");
    }

    await access(
      new URL(
        `../dist/${faviconHref.replace(/^\/Kitten\//, "")}`,
        import.meta.url,
      ),
    );
  });

  test("keeps product claims and install paths out of component markup", async () => {
    const componentFiles = (await readdir(componentRoot)).filter((file) =>
      file.endsWith(".astro"),
    );
    const sources = await Promise.all([
      readFile(new URL("../src/pages/index.astro", import.meta.url), "utf8"),
      ...componentFiles.map((file) =>
        readFile(new URL(file, componentRoot), "utf8"),
      ),
    ]);
    const componentSource = sources.join("\n");
    const narrative = [
      showcaseConfig.site.description,
      showcaseConfig.hero.heading,
      showcaseConfig.hero.body,
      showcaseConfig.hero.secondaryCtaLabel,
      showcaseConfig.hero.logoAlt,
      showcaseConfig.hero.outcomeTitle,
      showcaseConfig.hero.outcomeBody,
      showcaseConfig.hero.outcomeStatus,
      showcaseConfig.proof.heading,
      showcaseConfig.proof.body,
      showcaseConfig.install.heading,
      showcaseConfig.install.body,
      showcaseConfig.install.primaryInstallCmd,
      showcaseConfig.requirements.heading,
      showcaseConfig.requirements.body,
      showcaseConfig.faq.heading,
      showcaseConfig.faq.body,
      showcaseConfig.repository.url,
      ...showcaseConfig.proof.steps.flatMap((step) => [
        step.label,
        step.description,
      ]),
      ...showcaseConfig.hero.benefits,
      ...showcaseConfig.install.commands.flatMap((command) => [
        command.label,
        command.command,
        command.copyCtaLabel,
        command.shellCopyHint,
      ]),
      ...showcaseConfig.requirements.items,
      ...showcaseConfig.faq.items.flatMap((item) => [
        item.question,
        item.answer,
      ]),
    ];

    for (const claim of narrative) {
      expect(componentSource).not.toContain(claim);
    }
  });
});
