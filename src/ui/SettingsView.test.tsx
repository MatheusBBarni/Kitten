// Suite: SettingsView overlay
// Invariant: settings captures the keyboard, applies theme navigation live, and yields to approval.
// Boundary IN: real AppStore, OpenTUI keyboard routing, palette resolution, and rendered frame.
// Boundary OUT: shell opening/mount wiring (task 10) and disk persistence (task 09).

import { describe, expect, it, spyOn } from "bun:test"

import type { TextareaRenderable } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { ThemePreference } from "../core/types.ts"
import { createAppStore, type AppStore } from "../store/appStore.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { SETTINGS_HINT } from "./keymap.ts"
import {
  SETTINGS_TITLE,
  SettingsView,
  THEME_APPLY_LABEL,
  THEME_OPTION_MARKER,
  THEME_OPTIONS,
  THEME_TAB_LABEL,
  themePreferenceLabel,
} from "./SettingsView.tsx"
import { usePalette } from "./theme.ts"

const WIDTH = 72
const HEIGHT = 18

interface RenderSettingsOptions {
  approvalOpen?: boolean
  editor?: boolean
  open?: boolean
  preference?: ThemePreference
  probePalette?: boolean
}

interface SettingsSetup {
  controller: FakeController
  editor: { current: TextareaRenderable | null }
  setup: TestRendererSetup
  store: AppStore
}

/** A rendered consumer behind the modal, proving that the effective palette repaints. */
function PaletteProbe() {
  const palette = usePalette()
  return <text>{`Resolved palette: ${palette.id}`}</text>
}

async function renderSettings(options: RenderSettingsOptions = {}): Promise<SettingsSetup> {
  const store = createAppStore({ preferences: { theme: options.preference ?? "auto" } })
  const controller = createFakeController({ store })
  const editor: { current: TextareaRenderable | null } = { current: null }

  if (options.open !== false) store.openSettings()
  if (options.approvalOpen) {
    store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      request: {
        sessionId: "claude-code",
        toolCall: { toolCallId: "approval-1", kind: "other", title: "Approve action" },
        options: [{ optionId: "reject", name: "Reject", kind: "reject_once" }],
      },
    })
  }

  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <box style={{ width: "100%", height: "100%", flexDirection: "column" }}>
        <text>Live cockpit</text>
        {options.probePalette ? <PaletteProbe /> : null}
        {options.editor ? <textarea ref={editor} focused /> : null}
        <SettingsView />
      </box>
    </CockpitProvider>,
    { width: WIDTH, height: HEIGHT, kittyKeyboard: true },
  )
  await setup.waitForFrame((frame) => frame.includes("Live cockpit"))

  return { controller, editor, setup, store }
}

describe("SettingsView visibility", () => {
  it("renders nothing when the settings slot is null", async () => {
    const { setup } = await renderSettings({ open: false })

    const frame = setup.captureCharFrame()
    expect(frame).toContain("Live cockpit")
    expect(frame).not.toContain(SETTINGS_TITLE)
    expect(frame).not.toContain(SETTINGS_HINT)

    await destroyMounted(setup.renderer)
  })

  it("renders nothing while approval is open even when settings remains open", async () => {
    const { setup, store } = await renderSettings({ approvalOpen: true })

    const frame = setup.captureCharFrame()
    expect(store.getState().overlays.settings).toEqual({ tab: "theme" })
    expect(frame).not.toContain(SETTINGS_TITLE)
    expect(frame).not.toContain(SETTINGS_HINT)

    await destroyMounted(setup.renderer)
  })
})

describe("SettingsView theme tab", () => {
  it("lists all five options and marks only the current preference", async () => {
    const { setup } = await renderSettings({ preference: "dark" })
    const frame = await setup.waitForFrame((value) => value.includes(SETTINGS_HINT))

    expect(THEME_OPTIONS).toEqual(["auto", "light", "dark", "catppuccin-mocha", "catppuccin-latte"])
    for (const option of THEME_OPTIONS) expect(frame).toContain(themePreferenceLabel(option))
    expect(frame).toContain(`${THEME_OPTION_MARKER} Dark`)
    expect(frame.match(new RegExp(THEME_OPTION_MARKER, "gu"))).toHaveLength(1)

    await destroyMounted(setup.renderer)
  })

  it("labels theme changes as immediate and renders the keymap-derived footer", async () => {
    const { setup } = await renderSettings()
    const frame = await setup.waitForFrame((value) => value.includes(SETTINGS_HINT))

    expect(frame).toContain(THEME_TAB_LABEL)
    expect(frame).toContain(THEME_APPLY_LABEL)
    expect(frame).toContain(SETTINGS_HINT)

    await destroyMounted(setup.renderer)
  })

  it("matches the open Theme tab snapshot", async () => {
    const { setup } = await renderSettings({ preference: "dark" })
    await setup.waitForFrame((value) => value.includes(SETTINGS_HINT))

    const frame = setup
      .captureCharFrame()
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trimEnd()
    expect(frame).toMatchSnapshot("open-theme-tab")

    await destroyMounted(setup.renderer)
  })
})

describe("SettingsView interaction", () => {
  it("applies the next theme through setThemePreference as soon as selection moves", async () => {
    const { setup, store } = await renderSettings()
    const setThemePreference = spyOn(store, "setThemePreference")

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })

    expect(setThemePreference).toHaveBeenCalledWith("light")
    expect(store.getState().preferences.theme).toBe("light")
    setThemePreference.mockRestore()

    await destroyMounted(setup.renderer)
  })

  it("resets the theme preference to auto", async () => {
    const { setup, store } = await renderSettings({ preference: "catppuccin-mocha" })

    await actAsync(() => {
      setup.mockInput.pressKey("r")
    })

    expect(store.getState().preferences.theme).toBe("auto")

    await destroyMounted(setup.renderer)
  })

  it("closes settings on Escape", async () => {
    const { setup, store } = await renderSettings()

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })

    expect(store.getState().overlays.settings).toBeNull()
    expect(await setup.waitForFrame((frame) => !frame.includes(SETTINGS_HINT))).not.toContain(SETTINGS_TITLE)

    await destroyMounted(setup.renderer)
  })

  it("prevents unbound keys from reaching the focused editor beneath it", async () => {
    const { editor, setup } = await renderSettings({ editor: true })

    await actAsync(async () => {
      await setup.mockInput.typeText("x")
    })

    expect(editor.current?.plainText).toBe("")

    await destroyMounted(setup.renderer)
  })
})

describe("SettingsView live palette integration", () => {
  it("repaints a live palette consumer when arrow navigation changes the real store", async () => {
    const { setup, store } = await renderSettings({ probePalette: true })
    expect(await setup.waitForFrame((frame) => frame.includes("Resolved palette: dark"))).toContain(SETTINGS_TITLE)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })

    const repainted = await setup.waitForFrame((frame) => frame.includes("Resolved palette: light"))
    expect(store.getState().preferences.theme).toBe("light")
    expect(repainted).toContain(`${THEME_OPTION_MARKER} Light`)

    await destroyMounted(setup.renderer)
  })
})
