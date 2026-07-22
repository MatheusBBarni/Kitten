import { describe, expect, test } from "bun:test";
import type { ProfileId } from "@kitten/engine";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogProjection } from "../../persistence/eventJournal.ts";
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
    expect(markup).toContain("Future-card profile default");
    expect(markup).toContain("Existing card configuration and recorded Run Contexts stay unchanged");
    expect(markup).toContain("Ready (protocol 1)");
    expect(markup).toContain("Unavailable: Sign in to Claude.");
    expect(markup).toContain("disabled=\"\"");
  });

  test("renders canonicalization, collision, invalid-root diagnostics, and no free-text Skill selector", () => {
    const markup = renderToStaticMarkup(<CatalogRootsPanel catalog={catalog} busy={false} onSave={() => {}} />);
    expect(markup).toContain("/repo/skills-link → /repo/.agents/skills");
    expect(markup).toContain("/missing — invalid");
    expect(markup).toContain("verify");
    expect(markup).toContain("name collision");
    expect(markup).toContain("missing root:");
    expect(markup).toContain("never by free-text name");
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
});
