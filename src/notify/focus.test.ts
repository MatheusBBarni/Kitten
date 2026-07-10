import { describe, expect, it } from "bun:test"

import { CliRenderEvents } from "@opentui/core"

import { createRendererFocusSource, type FocusEmitter } from "./focus.ts"

/** A minimal focus emitter that lets a test replay the renderer's focus/blur events. */
function fakeRenderer(): FocusEmitter & { emit(event: string): void } {
  const listeners = new Map<string, (() => void)[]>()
  return {
    on(event, listener) {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
    },
    emit(event) {
      for (const listener of listeners.get(event) ?? []) listener()
    },
  }
}

describe("createRendererFocusSource", () => {
  it("starts unknown until the terminal first reports focus", () => {
    const source = createRendererFocusSource(fakeRenderer())
    expect(source.current()).toBe("unknown")
  })

  it("latches to focused on a focus event and unfocused on a blur event", () => {
    const renderer = fakeRenderer()
    const source = createRendererFocusSource(renderer)

    renderer.emit(CliRenderEvents.BLUR)
    expect(source.current()).toBe("unfocused")

    renderer.emit(CliRenderEvents.FOCUS)
    expect(source.current()).toBe("focused")

    renderer.emit(CliRenderEvents.BLUR)
    expect(source.current()).toBe("unfocused")
  })
})
