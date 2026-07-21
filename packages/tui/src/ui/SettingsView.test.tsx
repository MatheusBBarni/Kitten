// Suite: SettingsView overlay
// Invariant: settings captures the keyboard, applies theme navigation live, and yields to higher-priority agent interactions.
// Boundary IN: real AppStore, OpenTUI keyboard routing, palette resolution, and rendered frame.
// Boundary OUT: shell opening/mount wiring (task 10) and disk persistence (task 09).

import { describe, expect, it, spyOn } from "bun:test"

import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { THEME_PRESET_IDS, THEME_PRESETS } from "../core/themeCatalog.ts"
import type { ThemePreference } from "../core/types.ts"
import { createAppStore, type AppStore } from "../store/appStore.ts"
import { ClarificationPrompt } from "./ClarificationPrompt.tsx"
import { CockpitProvider } from "./cockpitContext.tsx"
import { SETTINGS_HINT } from "./keymap.ts"
import {
  SETTINGS_TITLE,
  SELECTABLE_THEME_PICKER_ROWS,
  SettingsView,
  THEME_APPLY_LABEL,
  THEME_CATALOG_DOCUMENTATION,
  THEME_OPTION_MARKER,
  THEME_OPTIONS,
  THEME_PICKER_ROWS,
  THEME_PICKER_SCROLLBOX_ID,
  THEME_TAB_LABEL,
  themePickerFamilyRowId,
  themePickerRowId,
  themePickerRows,
  themePreferenceLabel,
} from "./SettingsView.tsx"
import { usePalette } from "./theme.ts"

const WIDTH = 72
const HEIGHT = 18

interface RenderSettingsOptions {
  approvalOpen?: boolean
  clarificationOpen?: boolean
  clarificationPrompt?: boolean
  editor?: boolean
  height?: number
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
  if (options.clarificationOpen) {
    store.openClarification({
      requestId: "clarification-settings",
      generation: 1,
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      payload: {
        prompt: "Choose a boundary",
        fields: [{
          id: "boundary",
          label: "Boundary",
          mode: "single",
          allowsCustom: false,
          required: true,
          options: [
            { id: "controller", label: "Controller" },
            { id: "store", label: "Store" },
          ],
        }],
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
        {options.clarificationPrompt ? <ClarificationPrompt /> : null}
      </box>
    </CockpitProvider>,
    { width: WIDTH, height: options.height ?? HEIGHT, kittyKeyboard: true },
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

  it("renders nothing during clarification while the settings slot remains open", async () => {
    const { setup, store } = await renderSettings({ clarificationOpen: true, preference: "dark" })

    const frame = setup.captureCharFrame()
    expect(store.getState().overlays.settings).toEqual({ tab: "theme" })
    expect(store.getState().preferences.theme).toBe("dark")
    expect(frame).not.toContain(SETTINGS_TITLE)
    expect(frame).not.toContain(SETTINGS_HINT)

    await destroyMounted(setup.renderer)
  })
})

describe("SettingsView theme tab", () => {
  it("projects every canonical preset into deterministic family groups", () => {
    const presetRows = THEME_PICKER_ROWS.filter((row) => row.kind === "preset")
    const familyRows = THEME_PICKER_ROWS.filter((row) => row.kind === "family")
    const expectedFamilies = [...new Set(THEME_PRESETS.map((preset) => preset.family))]

    expect(THEME_OPTIONS.slice(0, 3)).toEqual(["auto", "light", "dark"])
    expect(presetRows.map((row) => row.preference)).toEqual([...THEME_PRESET_IDS])
    expect(presetRows.map((row) => row.label)).toEqual(THEME_PRESETS.map((preset) => preset.displayName))
    expect(familyRows.map((row) => row.family)).toEqual(expectedFamilies)
    expect(SELECTABLE_THEME_PICKER_ROWS).toHaveLength(3 + THEME_PRESET_IDS.length)
  })

  it("assigns stable unique IDs without collisions between headings and options", () => {
    const projectedAgain = themePickerRows()
    const allIds = THEME_PICKER_ROWS.map((row) => row.id)
    const familyIds = new Set(
      THEME_PICKER_ROWS.filter((row) => row.kind === "family").map((row) => row.id),
    )
    const selectableIds = SELECTABLE_THEME_PICKER_ROWS.map((row) => row.id)

    expect(projectedAgain.map((row) => row.id)).toEqual(allIds)
    expect(new Set(allIds)).toHaveLength(allIds.length)
    expect(selectableIds).toEqual(THEME_OPTIONS.map(themePickerRowId))
    expect(selectableIds.some((id) => familyIds.has(id))).toBe(false)
    expect(themePickerFamilyRowId("Rosé Pine")).not.toBe(themePickerRowId("rose-pine-main"))
  })

  it("renders grouped rows and marks only the current preference", async () => {
    const { setup } = await renderSettings({ preference: "dark" })
    const frame = await setup.waitForFrame((value) => value.includes(SETTINGS_HINT))

    expect(frame).toContain("Catppuccin")
    expect(frame).toContain(themePreferenceLabel("catppuccin-frappe"))
    expect(frame).toContain(`${THEME_OPTION_MARKER} Dark`)
    expect(frame.match(new RegExp(THEME_OPTION_MARKER, "gu"))).toHaveLength(1)
    expect(setup.renderer.root.findDescendantById(themePickerRowId("dark"))).toBeDefined()
    expect(setup.renderer.root.findDescendantById(themePickerFamilyRowId("Catppuccin"))).toBeDefined()

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

  it("points to public provenance documentation without embedding source metadata", async () => {
    const { setup } = await renderSettings()
    const frame = await setup.waitForFrame((value) => value.includes(THEME_CATALOG_DOCUMENTATION))

    expect(frame).toContain(THEME_CATALOG_DOCUMENTATION)
    for (const preset of THEME_PRESETS) expect(frame).not.toContain(preset.sourceUrl)
    expect(frame).not.toContain(THEME_PRESETS[0]?.licenseAttribution ?? "MIT")

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

  it("keeps an off-screen keyboard selection visible in the bounded scrollbox", async () => {
    const { setup, store } = await renderSettings({ height: 12 })
    const scrollbox = setup.renderer.root.findDescendantById(THEME_PICKER_SCROLLBOX_ID) as ScrollBoxRenderable | undefined

    expect(scrollbox).toBeDefined()
    await setup.waitFor(() => scrollbox!.scrollHeight > scrollbox!.viewport.height)
    const autoRow = setup.renderer.root.findDescendantById(themePickerRowId("auto"))
    const lightRow = setup.renderer.root.findDescendantById(themePickerRowId("light"))
    expect(autoRow).toBeDefined()
    expect(lightRow).toBeDefined()
    expect(lightRow!.y).toBeGreaterThan(autoRow!.y)
    const scrollChildIntoView = spyOn(scrollbox!, "scrollChildIntoView")

    for (let index = 1; index < THEME_OPTIONS.length; index += 1) {
      await actAsync(() => setup.mockInput.pressArrow("down"))
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const preference = THEME_OPTIONS[index]!
      const indentation = index < 3 ? " " : "   "
      expect(store.getState().preferences.theme).toBe(preference)
      expect(scrollChildIntoView).toHaveBeenCalledWith(themePickerRowId(preference))
      await setup.waitForFrame((frame) =>
        frame.includes(`${THEME_OPTION_MARKER}${indentation}${themePreferenceLabel(preference)}`),
      )
    }

    const finalPreference = THEME_OPTIONS[THEME_OPTIONS.length - 1]!
    expect(finalPreference).toBe("tokyo-night-storm")
    expect(store.getState().preferences.theme).toBe(finalPreference)
    const frame = await setup.waitForFrame((value) => value.includes(`${THEME_OPTION_MARKER}   Tokyo Night Storm`))
    expect(scrollChildIntoView).toHaveBeenCalledWith(themePickerRowId("tokyo-night-storm"))
    expect(frame).toContain("Tokyo Night Storm")
    expect(scrollbox!.scrollTop).toBeGreaterThan(0)
    scrollChildIntoView.mockRestore()

    await destroyMounted(setup.renderer)
  })

  it("reveals an already-selected off-screen preset when Settings mounts", async () => {
    const { setup } = await renderSettings({ height: 12, preference: "tokyo-night-storm" })
    const scrollbox = setup.renderer.root.findDescendantById(THEME_PICKER_SCROLLBOX_ID) as ScrollBoxRenderable | undefined

    expect(scrollbox).toBeDefined()
    await setup.waitFor(() => scrollbox!.scrollHeight > scrollbox!.viewport.height)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const frame = await setup.waitForFrame((value) =>
      value.includes(`${THEME_OPTION_MARKER}   Tokyo Night Storm`),
    )
    expect(frame).toContain("Tokyo Night Storm")
    expect(scrollbox!.scrollTop).toBeGreaterThan(0)

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

  it("does not handle arrows, reset, or Escape while clarification is active", async () => {
    const { setup, store } = await renderSettings({
      clarificationOpen: true,
      preference: "catppuccin-mocha",
    })
    const closeSettings = spyOn(store, "closeSettings")
    const setThemePreference = spyOn(store, "setThemePreference")

    await actAsync(() => {
      setup.mockInput.pressArrow("up")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressKey("r")
      setup.mockInput.pressEscape()
    })

    expect(closeSettings).not.toHaveBeenCalled()
    expect(setThemePreference).not.toHaveBeenCalled()
    expect(store.getState().overlays.settings).toEqual({ tab: "theme" })
    expect(store.getState().preferences.theme).toBe("catppuccin-mocha")
    closeSettings.mockRestore()
    setThemePreference.mockRestore()

    await destroyMounted(setup.renderer)
  })

  it("restores the unchanged settings dialog after clarification settles", async () => {
    const { controller, setup, store } = await renderSettings({
      clarificationOpen: true,
      clarificationPrompt: true,
      preference: "dark",
    })
    await setup.waitForFrame((frame) => frame.includes("Choose a boundary"))

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })

    expect(controller.calls.respondClarification).toEqual([{
      requestId: "clarification-settings",
      generation: 1,
      outcome: { kind: "cancelled" },
    }])
    expect(store.getState().overlays.settings).toEqual({ tab: "theme" })
    expect(store.getState().preferences.theme).toBe("dark")
    const resumed = await setup.waitForFrame((frame) => frame.includes(SETTINGS_HINT))
    expect(resumed).toContain(`${THEME_OPTION_MARKER} Dark`)

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
