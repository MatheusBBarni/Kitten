import { describe, expect, it } from "bun:test"

import {
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
  type ProviderRuntimeProfile,
  type SessionId,
} from "./types.ts"

describe("provider identity contracts", () => {
  it("keeps provider constants and shared display metadata exhaustive for Cursor", () => {
    expect(PROVIDER_KINDS).toEqual(["claude-code", "codex", "cursor"])
    expect(DEFAULT_PROVIDER_ORDER).toEqual(["codex", "claude-code", "cursor"])
    expect(PROVIDER_METADATA).toEqual({
      "claude-code": { displayName: "Claude Code", compactLabel: "Claude" },
      codex: { displayName: "Codex", compactLabel: "Codex" },
      cursor: { displayName: "Cursor", compactLabel: "Cursor" },
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
    const payload: ClarificationPayload = { prompt: "How should I proceed?", fields }
    const answered: ClarificationOutcome = {
      kind: "answered",
      values: { runtime: "bun", checks: ["types", "tests"], notes: "Keep it small" },
    }
    const cancelled: ClarificationOutcome = { kind: "cancelled" }

    expect(payload).toEqual({ prompt: "How should I proceed?", fields })
    expect(answered.kind).toBe("answered")
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
    // @ts-expect-error Answer values are normalized to strings or string arrays.
    acceptOutcome({ kind: "answered", values: { runtime: 1 } })
    // @ts-expect-error Cancellation carries no answer values.
    acceptOutcome({ kind: "cancelled", values: {} })

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
