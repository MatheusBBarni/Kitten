import { describe, expect, it } from "bun:test"

import {
  CONTEXT_BRIEF_SECTION_KEYS,
  DEFAULT_PROVIDER_ORDER,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_KINDS,
  PROVIDER_METADATA,
  VISIBLE_CATEGORIES,
  visibleConfigOptions,
  type ClarificationField,
  type ClarificationOutcome,
  type ClarificationPayload,
  type ConfigOption,
  type ContextBrief,
  type ContextSelection,
  type ManagedWorktreeAvailability,
  type ManagedWorktreeBinding,
  type ManagedWorktreeReason,
  type ProviderRuntimeProfile,
  type RecipientFit,
  type RevisionFencedContextPackMutation,
  type SessionId,
} from "./types.ts"

describe("managed-worktree contracts", () => {
  it("keeps availability and lifecycle reasons bounded and protocol-free", () => {
    const availabilities: ManagedWorktreeAvailability[] = [
      "unverified",
      "available",
      "unavailable",
      "cleanup_refused",
    ]
    const reasons: Record<ManagedWorktreeReason, true> = {
      not_git_repository: true,
      detached_head: true,
      submodules_unsupported: true,
      root_conflict: true,
      collision: true,
      verification_failed: true,
      missing: true,
      external: true,
      dirty: true,
      unmerged: true,
      live_owned: true,
      not_managed: true,
      git_failed: true,
    }
    const binding: ManagedWorktreeBinding = {
      kind: "managed",
      id: "kitten-1",
      repoRoot: "/repo",
      worktreePath: "/repo/.kitten/worktrees/kitten-1",
      branch: "kitten/kitten-1",
      baseBranch: "main",
      baseSha: "abc123",
      ownerSessionId: "child-1",
      availability: "unverified",
    }

    expect(availabilities).toEqual([
      "unverified",
      "available",
      "unavailable",
      "cleanup_refused",
    ])
    expect(Object.keys(reasons)).toHaveLength(13)
    expect(binding).not.toHaveProperty("git")
    expect(binding).not.toHaveProperty("runtime")
    expect(binding).not.toHaveProperty("acpSessionId")

    if (false) {
      // @ts-expect-error Managed bindings are immutable domain values.
      binding.branch = "other"
    }
  })
})

describe("provider identity contracts", () => {
  it("keeps provider constants and shared display metadata exhaustive for Cursor", () => {
    expect(PROVIDER_KINDS).toEqual(["claude-code", "codex", "cursor"])
    expect(DEFAULT_PROVIDER_ORDER).toEqual(["codex", "claude-code", "cursor"])
    expect(PROVIDER_METADATA).toEqual({
      "claude-code": { displayName: "Claude Code", compactLabel: "Claude" },
      codex: { displayName: "Codex", compactLabel: "Codex" },
      cursor: { displayName: "Cursor", compactLabel: "Cursor", fixedReasoningEffort: "default" },
    })
    expect(PROVIDER_DISPLAY_NAMES).toEqual({ "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor" })
  })

  it("keeps runtime profiles protocol-free and session identity per instance", () => {
    const standard: ProviderRuntimeProfile = { kind: "standard" }
    const certified: ProviderRuntimeProfile = {
      kind: "cursor-certified",
      command: "agent",
      args: ["acp"],
      env: {},
      certifiedVersion: "1.2.3",
      authenticationMethod: "cursor_login",
    }
    const sessions: SessionId[] = ["cursor", "cursor-2"]

    expect(standard).toEqual({ kind: "standard" })
    expect(certified).not.toHaveProperty("protocolVersion")
    expect(sessions).toEqual(["cursor", "cursor-2"])
  })
})

describe("clarification contracts", () => {
  it("represents normalized single, multi, and text fields without lifecycle data", () => {
    const fields: ClarificationField[] = [
      {
        id: "runtime",
        label: "Runtime",
        description: "Choose one runtime",
        mode: "single",
        allowsCustom: true,
        required: true,
        options: [
          { id: "bun", label: "Bun", description: "Use the repository runtime" },
          { id: "node", label: "Node.js" },
        ],
      },
      {
        id: "checks",
        label: "Checks",
        mode: "multi",
        allowsCustom: false,
        required: false,
        options: [
          { id: "types", label: "Typecheck" },
          { id: "tests", label: "Tests" },
        ],
      },
      {
        id: "notes",
        label: "Notes",
        description: "Add any constraints",
        mode: "text",
        required: false,
      },
    ]
    const payload: ClarificationPayload = {
      title: "Implementation decision",
      context: "Keep the adapter boundary protocol-free.",
      prompt: "How should I proceed?",
      fields,
    }
    const submitted: ClarificationOutcome = {
      kind: "submitted",
      answers: {
        runtime: { selectedOptionIds: ["bun"], customText: "Use the pinned runtime" },
        checks: { selectedOptionIds: ["types", "tests"] },
        notes: { selectedOptionIds: [], customText: "Keep it small" },
      },
    }
    const cancelled: ClarificationOutcome = { kind: "cancelled" }

    expect(payload).toEqual({
      title: "Implementation decision",
      context: "Keep the adapter boundary protocol-free.",
      prompt: "How should I proceed?",
      fields,
    })
    expect(submitted.kind).toBe("submitted")
    expect(submitted.answers.runtime).toEqual({
      selectedOptionIds: ["bun"],
      customText: "Use the pinned runtime",
    })
    expect(cancelled).toEqual({ kind: "cancelled" })
    expect(payload).not.toHaveProperty("requestId")
    expect(payload).not.toHaveProperty("connectionGeneration")
  })

  it("rejects non-normalized field shapes at the type boundary", () => {
    const accept = (_field: ClarificationField): void => undefined
    const acceptOutcome = (_outcome: ClarificationOutcome): void => undefined

    // @ts-expect-error Choice fields require a normalized option list.
    accept({ id: "runtime", label: "Runtime", mode: "single", required: true })
    // @ts-expect-error Text fields cannot carry choice options.
    accept({ id: "notes", label: "Notes", mode: "text", required: false, options: [] })
    // @ts-expect-error Submitted answers preserve structured selections and custom text.
    acceptOutcome({ kind: "submitted", answers: { runtime: "bun" } })
    // @ts-expect-error Cancellation carries no answers.
    acceptOutcome({ kind: "cancelled", answers: {} })

    const terminalKinds: ClarificationOutcome["kind"][] = [
      "submitted",
      "skipped",
      "timed_out",
      "cancelled",
    ]
    expect(terminalKinds).toHaveLength(4)

    expect(true).toBe(true)
  })
})

/**
 * The fail-closed category allowlist (ADR-004). `visibleConfigOptions` is the single
 * gate between the generic config-option channel and the rendered UI, so its whole job
 * is to let only `model` and `thought_level` through and drop everything else - most
 * importantly `mode`, whose Claude values include `bypassPermissions`.
 */

const option = (category: string, id = category): ConfigOption => ({
  id,
  category,
  label: category,
  currentValue: "x",
  options: [{ value: "x", name: "X" }],
})

describe("visibleConfigOptions", () => {
  it("keeps the model and thought_level options", () => {
    const model = option("model")
    const effort = option("thought_level", "effort")

    expect(visibleConfigOptions([model, effort])).toEqual([model, effort])
  })

  it("drops the mode category so bypassPermissions can never surface", () => {
    const model = option("model")
    const mode = option("mode")

    const visible = visibleConfigOptions([mode, model])

    expect(visible).toEqual([model])
    expect(visible.some((o) => o.category === "mode")).toBe(false)
  })

  it("drops model_config", () => {
    const effort = option("thought_level", "effort")

    expect(visibleConfigOptions([option("model_config"), effort])).toEqual([effort])
  })

  it("drops an unknown or future category not on the allowlist", () => {
    const model = option("model")

    expect(visibleConfigOptions([option("provider"), model, option("some_future_category")])).toEqual([model])
  })

  it("preserves the order of the allowlisted options", () => {
    const effort = option("thought_level", "effort")
    const model = option("model")

    expect(visibleConfigOptions([effort, option("mode"), model])).toEqual([effort, model])
  })

  it("returns an empty list when nothing is allowlisted", () => {
    expect(visibleConfigOptions([option("mode"), option("model_config")])).toEqual([])
  })

  it("exposes exactly model and thought_level as the visible categories", () => {
    expect(VISIBLE_CATEGORIES).toEqual(["model", "thought_level"])
  })
})

describe("context-pack protocol-free vocabulary", () => {
  it("keeps the fixed brief sections and closed selection kinds explicit", () => {
    const brief: ContextBrief = {
      architecture: "Core owns deterministic values.",
      selectedContext: "src/core/contextPack.ts",
      relationships: "The application supplies bounded artifacts.",
      ambiguities: "Recipient counters arrive later.",
      budgetOmissions: "No omitted source.",
    }
    const selections: ContextSelection["kind"][] = ["full_file", "file_slice", "diff"]

    expect(CONTEXT_BRIEF_SECTION_KEYS).toEqual([
      "architecture",
      "selectedContext",
      "relationships",
      "ambiguities",
      "budgetOmissions",
    ])
    expect(Object.keys(brief)).toEqual([...CONTEXT_BRIEF_SECTION_KEYS])
    expect(selections).toEqual(["full_file", "file_slice", "diff"])
  })

  it("represents recipient outcomes as one closed discriminated union", () => {
    const outcomes: RecipientFit[] = [
      { kind: "fit", exactCount: 100, remaining: 900 },
      { kind: "unavailable", reason: "stale_evidence" },
      { kind: "insufficient", exactCount: 1_100, remaining: -100 },
    ]

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["fit", "unavailable", "insufficient"])
  })

  it("rejects raw source content and custom brief shapes at compile time", () => {
    const acceptSelection = (_selection: ContextSelection): void => undefined
    const acceptBrief = (_brief: ContextBrief): void => undefined
    const acceptBuilderMutation = (_mutation: RevisionFencedContextPackMutation): void => undefined
    const source = { identity: "file:src/a.ts", digest: "a".repeat(64), bytes: 1 }

    // @ts-expect-error Draft selections are metadata-only and cannot retain source content.
    acceptSelection({ kind: "full_file", path: "src/a.ts", source, rationale: "needed", relationship: "used", content: "x" })
    // @ts-expect-error All five fixed Context Brief sections are required.
    acceptBrief({ architecture: "", selectedContext: "", relationships: "", ambiguities: "" })
    // @ts-expect-error Builders cannot mutate the operator-owned Pack Budget.
    acceptBuilderMutation({ readRevision: 0, mutation: { kind: "set_budget", limit: 1 } })

    expect(true).toBe(true)
  })
})
