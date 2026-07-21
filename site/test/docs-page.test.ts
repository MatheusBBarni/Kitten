import { beforeAll, describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { configDocs } from "../src/config/config-docs.ts";

const siteRoot = new URL("../", import.meta.url);
let renderedHtml = "";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
  await access(new URL("../dist/docs/index.html", import.meta.url));
  renderedHtml = await readFile(
    new URL("../dist/docs/index.html", import.meta.url),
    "utf8",
  );
});

describe("configuration docs page", () => {
  test("renders one documentation route with a stable configuration outline", () => {
    expect(renderedHtml.match(/<h1\b/g)).toHaveLength(1);
    expect(renderedHtml).toContain('aria-current="page"');
    expect(renderedHtml).toContain('href="../"');
    expect(renderedHtml).toContain('href="../#proof"');
    expect(renderedHtml).toContain('href="../#install"');

    for (const topic of configDocs.topics) {
      expect(renderedHtml).toContain(`id="${topic.id}"`);
      expect(renderedHtml).toContain(`href="#${topic.id}"`);
    }
  });

  test("documents the strict config path, current provider roster, and safe MCP boundary", () => {
    for (const claim of [
      configDocs.hero.heading,
      "KITTEN_CONFIG",
      "$XDG_CONFIG_HOME/kitten/config.json",
      "~/.config/kitten/config.json",
      "claude-code",
      "codex",
      "cursor",
      "More Agent Client Protocol",
      "kitten-ask-user",
      "Remote HTTP and SSE",
      "llmDisclosureAcknowledged",
    ]) {
      expect(renderedHtml).toContain(escapeHtml(claim));
    }

    expect(renderedHtml).toContain(escapeHtml(configDocs.starterConfig));
    expect(renderedHtml).toContain(escapeHtml(configDocs.providerConfig));
    expect(renderedHtml).toContain(escapeHtml(configDocs.mcpConfig));
    expect(renderedHtml).toContain(escapeHtml(configDocs.editorConfig));
  });

  test("keeps the configuration reference aligned with the runtime schema", async () => {
    const loaderSource = await readFile(
      new URL("../../packages/tui/src/config/configLoader.ts", import.meta.url),
      "utf8",
    );

    for (const runtimeContract of [
      'CONFIG_PATH_ENV_VAR = "KITTEN_CONFIG"',
      '"claude-code"',
      'codex:',
      'cursor:',
      "providerDefaults:",
      "transcriptWindowingEnabled:",
      "mcpServers:",
      'z.literal("stdio")',
      "MAX_SHELL_SCROLLBACK = 100_000",
      "MAX_CLARIFICATION_TIMEOUT_SECONDS = 3_600",
    ]) {
      expect(loaderSource).toContain(runtimeContract);
    }
  });

  test("uses semantic navigation, sections, lists, and copy-safe code blocks", () => {
    expect(renderedHtml).toContain('<main class="docs-main" id="main-content">');
    expect(renderedHtml).toContain('aria-label="Configuration topics"');
    expect(renderedHtml).toContain('class="docs-reference-list"');
    expect(renderedHtml).toContain('class="docs-code"');
    expect(renderedHtml).not.toContain("<div onClick");
  });
});
