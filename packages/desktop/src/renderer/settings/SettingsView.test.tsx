import { describe, expect, test } from "bun:test";
import type { ProfileId } from "@kitten/engine";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogProjection } from "../../persistence/eventJournal.ts";
import { AcpProvidersPanel } from "./AcpProvidersPanel.tsx";
import { CatalogRootsPanel } from "./CatalogRootsPanel.tsx";
import { ExecutionLimitPanel, parseExecutionLimit } from "./ExecutionLimitPanel.tsx";
import { ProfileDefaultsPanel } from "./ProfileDefaultsPanel.tsx";
import {
  SettingsFeedback,
  SettingsLoadingState,
  SettingsUnavailableState,
} from "./SettingsView.tsx";

const READY_ID = "profile-ready" as ProfileId;
const UNREADY_ID = "profile-unready" as ProfileId;

const catalog: CatalogProjection = {
  catalogId: "default",
  roots: [
    { rootClass: "project", configuredPath: "/repo/skills-link", canonicalPath: "/repo/.agents/skills", order: 0, valid: true, diagnostics: [] },
    { rootClass: "user", configuredPath: "/missing", canonicalPath: null, order: 1, valid: false, diagnostics: [] },
  ],
  entries: [{
    skillId: `skill:${"a".repeat(64)}` as never,
    canonicalPath: "/repo/.agents/skills/verify/SKILL.md",
    rootClass: "project",
    rootPath: "/repo/.agents/skills",
    digest: "a".repeat(64),
    metadata: { name: "verify", description: "Verify work", frontmatter: {} },
    order: 0,
    hasNameCollision: true,
    diagnostics: [],
  }],
  diagnostics: [{
    diagnosticId: "diagnostic-missing",
    code: "missing_root",
    severity: "error",
    message: "Catalog root does not exist: /missing",
    rootClass: "user",
    configuredPath: "/missing",
    canonicalPath: null,
    skillPath: null,
    displayName: null,
    relatedSkillIds: [],
  }],
};

describe("settings renderer states", () => {
  test("renders loading, host error retry, and stale conflict feedback as keyboard-reachable states", () => {
    const loading = renderToStaticMarkup(<SettingsLoadingState />);
    const unavailable = renderToStaticMarkup(<SettingsUnavailableState retry={() => {}} />);
    const conflict = renderToStaticMarkup(<SettingsFeedback feedback={{
      tone: "error",
      message: "Settings changed before this action was committed. Review the refreshed values and try again.",
    }} />);
    expect(loading).toContain("aria-busy=\"true\"");
    expect(unavailable).toContain("role=\"alert\"");
    expect(unavailable).toContain("<button");
    expect(unavailable).toContain("Retry settings");
    expect(conflict).toContain("role=\"alert\"");
    expect(conflict).toContain("refreshed values");
  });

  test("renders ready and unavailable profiles with an explicit future-card default", () => {
    const markup = renderToStaticMarkup(
      <ProfileDefaultsPanel
        profiles={[
          { profileId: READY_ID, provider: "Codex", models: ["gpt-5"], efforts: ["high"], readiness: { ready: true, protocolVersion: 1 } },
          { profileId: UNREADY_ID, provider: "Claude", models: ["opus"], efforts: ["high"], readiness: { ready: false, reason: "authentication_required", message: "Sign in to Claude." } },
        ]}
        defaults={{ profileId: READY_ID, model: "gpt-5", effort: "high", appliesTo: "future_cards" }}
        busy={false}
        onSave={() => {}}
      />,
    );
    expect(markup).toContain("Defaults for new tasks");
    expect(markup).toContain("Existing tasks and run history do not change");
    expect(markup).toContain("Ready");
    expect(markup).toContain("Needs setup");
    expect(markup).toContain("Sign in to Claude.");
    expect(markup).not.toContain("Claude — unavailable");
  });

  test("explains the no-ready-agent state without presenting dead default controls", () => {
    const markup = renderToStaticMarkup(
      <ProfileDefaultsPanel
        profiles={[]}
        defaults={{ profileId: null, model: null, effort: null, appliesTo: "future_cards" }}
        busy={false}
        onSave={() => {}}
      />,
    );
    expect(markup).toContain("No ready task agents");
    expect(markup).toContain("create draft tasks");
    expect(markup).not.toContain("Save task defaults");
  });

  test("renders canonicalization, collision, invalid-root diagnostics, and no free-text Skill selector", () => {
    const markup = renderToStaticMarkup(<CatalogRootsPanel catalog={catalog} busy={false} onSave={() => {}} />);
    expect(markup).toContain("Resolves to /repo/.agents/skills");
    expect(markup).toContain("Invalid or unavailable");
    expect(markup).toContain("verify");
    expect(markup).not.toContain("name collision");
    expect(markup).toContain("Missing Root");
    expect(markup).toContain("never a typed name");
    expect(markup.match(/<textarea/g)).toHaveLength(2);
    expect(markup).not.toContain("Skill name<input");
  });

  test("renders the default limit of one and rejects non-positive or fractional input without coercion", () => {
    const markup = renderToStaticMarkup(<ExecutionLimitPanel limit={1} activeCount={0} busy={false} onSave={() => {}} />);
    expect(markup).toContain("value=\"1\"");
    expect(markup).toContain("Fresh installations start at 1.");
    expect(parseExecutionLimit("0")).toEqual({ valid: false, message: "Enter a positive whole number. The value was not changed." });
    expect(parseExecutionLimit("1.5").valid).toBeFalse();
    expect(parseExecutionLimit(" 2 ").valid).toBeFalse();
    expect(parseExecutionLimit("2")).toEqual({ valid: true, value: 2 });
  });

  test("shows machine-detected ACP providers separately from certified execution readiness", () => {
    const markup = renderToStaticMarkup(<AcpProvidersPanel providers={[
      {
        providerId: "claude-code",
        displayName: "Claude Code",
        configuredBy: "kitten_default",
        configuredCommand: "npx",
        detectedCommands: ["claude"],
        models: ["default", "sonnet"],
        efforts: ["default", "high"],
        availability: "available",
      },
      {
        providerId: "cursor",
        displayName: "Cursor",
        configuredBy: "kitten_config",
        configuredCommand: "agent",
        detectedCommands: [],
        models: ["default"],
        efforts: ["default"],
        availability: "not_detected",
      },
    ]} />);

    expect(markup).toContain("Agent clients (ACP)");
    expect(markup).toContain("Claude Code");
    expect(markup).toContain("Built-in Kitten setup");
    expect(markup).toContain("Detected");
    expect(markup).toContain("Cursor");
    expect(markup).toContain("Kitten configuration");
    expect(markup).toContain("Not detected");
    expect(markup).toContain("needs a ready profile");
  });
});
