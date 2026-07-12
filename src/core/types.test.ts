import { describe, expect, it } from "bun:test"

import { VISIBLE_CATEGORIES, visibleConfigOptions, type ConfigOption } from "./types.ts"

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
