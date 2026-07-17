// Suite: captured-session Context Pack whole-file membership.
// Invariant: discovery and mutations use ControllerActions; membership remains AppStore-owned.

import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import {
  type ContextPackFileMembershipInput,
  type ContextPackFileMembershipResult,
} from "../app/actions.ts"
import { contextSelectionKey } from "../core/contextPack.ts"
import type { ContextPackMutation, ContextPackState, ContextSelection, SessionId } from "../core/types.ts"
import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  CONTEXT_PACK_FILE_EXPLORER_EMPTY,
  CONTEXT_PACK_FILE_EXPLORER_LOADING,
  CONTEXT_PACK_FILE_EXPLORER_MISSING_DRAFT,
  CONTEXT_PACK_FILE_EXPLORER_ROW_PREFIX,
  CONTEXT_PACK_FILE_EXPLORER_SEALED_ONLY,
  CONTEXT_PACK_FILE_EXPLORER_STALE,
  CONTEXT_PACK_FILE_EXPLORER_TITLE,
  CONTEXT_PACK_FILE_EXPLORER_UNAVAILABLE,
  ContextPackFileExplorer,
} from "./ContextPackFileExplorer.tsx"

const SOURCE = {
  identity: "file:1:1",
  digest: "a".repeat(64),
  bytes: 12,
}

function installDraft(controller: FakeController, sessionId: SessionId = "claude-code"): void {
  const result = controller.store.createContextPackDraft(sessionId, "Explore whole-file membership")
  if (result?.kind !== "created") throw new Error("draft fixture failed")
}

function apply(controller: FakeController, mutation: ContextPackMutation, sessionId: SessionId = "claude-code"): void {
  const result = controller.store.applyContextPackOperatorMutation(sessionId, mutation)
  if (result?.kind !== "applied") throw new Error(`mutation fixture failed: ${result?.kind ?? "missing"}`)
}

function installPack(controller: FakeController, pack: ContextPackState, sessionId: SessionId = "claude-code"): void {
  const state = controller.store.getState()
  controller.store.replaceSessions(state.workspace.order.map((id) => {
    const session = state.sessions[id]!
    return {
      seed: {
        id: session.id,
        providerKind: session.providerKind,
        title: session.title,
        cwd: session.cwd,
        task: session.task,
        worktreeBinding: session.worktreeBinding,
        acpSessionId: session.acpSessionId,
      },
      workspace: state.workspace.conversations[id]!,
      contextPack: id === sessionId ? pack : state.contextPacks[id],
    }
  }), state.workspace.selectedVisibleId)
}

function productionLikeMembership(
  controller: FakeController,
): (input: ContextPackFileMembershipInput) => ContextPackFileMembershipResult {
  return (input) => {
    const draft = controller.store.getState().contextPacks[input.sessionId]?.draft
    if (!draft) return { kind: "denied", reason: "draft_unavailable" }
    if (draft.revision !== input.readRevision) {
      return { kind: "stale", readRevision: input.readRevision, currentRevision: draft.revision }
    }
    const exact = draft.selections.find(
      (selection) => selection.kind === "full_file" && selection.path === input.path,
    )
    const mutation: ContextPackMutation = input.operation === "add"
      ? {
          kind: "upsert_selection",
          selection: {
            kind: "full_file",
            path: input.path,
            source: SOURCE,
            rationale: "Added explicitly by the operator",
            relationship: "Whole-file Context Pack membership",
          },
        }
      : exact
        ? { kind: "remove_selection", selectionKey: contextSelectionKey(exact) }
        : { kind: "remove_selection", selectionKey: JSON.stringify(["full_file", input.path]) }
    const result = controller.store.applyContextPackOperatorMutation(input.sessionId, mutation)
    return result?.kind === "applied"
      ? { kind: "applied", operation: input.operation, revision: result.draft.revision }
      : { kind: "denied", reason: "invalid_mutation" }
  }
}

async function renderExplorer(controller: FakeController, active = true): Promise<TestRendererSetup> {
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <ContextPackFileExplorer sessionId="claude-code" active={active} />
    </CockpitProvider>,
    { width: 120, height: 18, kittyKeyboard: true, exitOnCtrlC: false },
  )
  await actAsync(async () => { await Promise.resolve() })
  await setup.waitForFrame((frame) => frame.includes(CONTEXT_PACK_FILE_EXPLORER_TITLE))
  return setup
}

function pointOf(frame: string, text: string): { x: number; y: number } {
  const lines = frame.replace(/\n$/u, "").split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`Could not find ${text} in frame`)
  return { x: lines[y]!.indexOf(text) + 1, y }
}

describe("ContextPackFileExplorer discovery and membership", () => {
  it("renders lexical safe paths and marks only an existing whole-file selection as in the pack", async () => {
    const controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["z.ts", "src/a.ts"] }),
    })
    installDraft(controller)
    apply(controller, {
      kind: "upsert_selection",
      selection: {
        kind: "full_file",
        path: "src/a.ts",
        source: SOURCE,
        rationale: "Required source",
        relationship: "Entry point",
      },
    })
    const setup = await renderExplorer(controller)

    try {
      const frame = await setup.waitForFrame((value) => value.includes("src/a.ts — In Context Pack"))
      expect(frame.indexOf("src/a.ts")).toBeLessThan(frame.indexOf("z.ts"))
      expect(frame).toContain("z.ts — Not in Context Pack · Add to Context Pack")
      expect(controller.calls.listRepositoryFiles).toEqual(["claude-code"])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("uses Enter and Space plus mouse to add and remove one addressed whole file", async () => {
    let controller: FakeController
    controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["src/a.ts"] }),
      mutateContextPackFileMembership: (input) => productionLikeMembership(controller)(input),
    })
    installDraft(controller)
    const setup = await renderExplorer(controller)

    try {
      await setup.waitForFrame((frame) => frame.includes("src/a.ts — Not in Context Pack"))
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Applied: Added src/a.ts"))
      expect(controller.store.getState().contextPacks["claude-code"]?.draft?.selections).toHaveLength(1)

      await actAsync(() => setup.mockInput.pressKey(" "))
      const removed = await setup.waitForFrame((frame) => frame.includes("Applied: Removed src/a.ts"))
      expect(removed).toContain("src/a.ts — Not in Context Pack")

      const point = pointOf(removed, "src/a.ts")
      await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
      await setup.waitForFrame((frame) => frame.includes("Applied: Added src/a.ts"))
      expect(controller.calls.mutateContextPackFileMembership.map(({ operation }) => operation)).toEqual([
        "add",
        "remove",
        "add",
      ])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("removes exact full-file identity without removing same-path slice or diff selections", async () => {
    let controller: FakeController
    controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["src/a.ts"] }),
      mutateContextPackFileMembership: (input) => productionLikeMembership(controller)(input),
    })
    installDraft(controller)
    const selections: ContextSelection[] = [
      {
        kind: "full_file",
        path: "src/a.ts",
        source: SOURCE,
        rationale: "Whole file",
        relationship: "Membership row",
      },
      {
        kind: "file_slice",
        path: "src/a.ts",
        range: { startLine: 1, endLine: 2 },
        source: { ...SOURCE, identity: "slice:1:1:1-2" },
        rationale: "Focused slice",
        relationship: "Independent selection",
      },
      {
        kind: "diff",
        path: "src/a.ts",
        scope: "unstaged",
        source: { ...SOURCE, identity: "diff:unstaged:1:1" },
        rationale: "Current change",
        relationship: "Independent diff",
      },
    ]
    for (const selection of selections) apply(controller, { kind: "upsert_selection", selection })
    const setup = await renderExplorer(controller)

    try {
      await setup.waitForFrame((frame) => frame.includes("src/a.ts — In Context Pack"))
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => frame.includes("Applied: Removed src/a.ts"))
      const remaining = controller.store.getState().contextPacks["claude-code"]?.draft?.selections ?? []
      expect(remaining.map(({ kind }) => kind)).toEqual(["file_slice", "diff"])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})

describe("ContextPackFileExplorer closed states", () => {
  it("shows loading, empty, and unavailable discovery with no actionable row", async () => {
    let resolveFiles!: (value: { kind: "ready"; paths: readonly string[] }) => void
    const deferred = new Promise<{ kind: "ready"; paths: readonly string[] }>((resolve) => { resolveFiles = resolve })
    const loadingController = createFakeController({ listRepositoryFiles: () => deferred })
    installDraft(loadingController)
    const loading = await renderExplorer(loadingController)
    try {
      expect(loading.captureCharFrame()).toContain(CONTEXT_PACK_FILE_EXPLORER_LOADING)
      expect(loading.renderer.root.findDescendantById(`${CONTEXT_PACK_FILE_EXPLORER_ROW_PREFIX}0`)).toBeUndefined()
      await actAsync(() => resolveFiles({ kind: "ready", paths: [] }))
      expect(await loading.waitForFrame((frame) => frame.includes(CONTEXT_PACK_FILE_EXPLORER_EMPTY))).not.toContain("Add to Context Pack")
    } finally {
      await destroyMounted(loading.renderer)
    }

    const unavailableController = createFakeController({
      listRepositoryFiles: () => ({ kind: "unavailable", reason: "not_repository" }),
    })
    installDraft(unavailableController)
    const unavailable = await renderExplorer(unavailableController)
    try {
      const frame = await unavailable.waitForFrame((value) => value.includes(CONTEXT_PACK_FILE_EXPLORER_UNAVAILABLE))
      expect(frame).toContain("Not repository")
      expect(frame).not.toContain("Add to Context Pack")
    } finally {
      await destroyMounted(unavailable.renderer)
    }
  })

  it("makes missing draft, sealed-only, and stale draft states explicit and non-actionable", async () => {
    const missingController = createFakeController({ listRepositoryFiles: () => ({ kind: "ready", paths: ["a.ts"] }) })
    const missing = await renderExplorer(missingController)
    try {
      expect(await missing.waitForFrame((frame) => frame.includes(CONTEXT_PACK_FILE_EXPLORER_MISSING_DRAFT))).not.toContain("Add to Context Pack")
    } finally {
      await destroyMounted(missing.renderer)
    }

    const sealedController = createFakeController({ listRepositoryFiles: () => ({ kind: "ready", paths: ["a.ts"] }) })
    installPack(sealedController, {
      draft: null,
      review: null,
      build: null,
      sealed: { restored: true, revision: 4, payload: "sealed", bytes: 6, sealedAt: 10 },
    })
    const sealed = await renderExplorer(sealedController)
    try {
      expect(await sealed.waitForFrame((frame) => frame.includes(CONTEXT_PACK_FILE_EXPLORER_SEALED_ONLY))).not.toContain("Remove from Context Pack")
    } finally {
      await destroyMounted(sealed.renderer)
    }

    const staleController = createFakeController({ listRepositoryFiles: () => ({ kind: "ready", paths: ["a.ts"] }) })
    installDraft(staleController)
    const stalePack = staleController.store.getState().contextPacks["claude-code"]!
    installPack(staleController, { ...stalePack, draft: { ...stalePack.draft!, stale: { kind: "stale", reason: "source_changed" } } })
    const stale = await renderExplorer(staleController)
    try {
      expect(await stale.waitForFrame((frame) => frame.includes(CONTEXT_PACK_FILE_EXPLORER_STALE))).not.toContain("Add to Context Pack")
    } finally {
      await destroyMounted(stale.renderer)
    }
  })

  it("preserves membership and shows bounded stale and typed-denial feedback", async () => {
    let attempt = 0
    const controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["a.ts"] }),
      mutateContextPackFileMembership: (input) => ++attempt === 1
        ? { kind: "stale", readRevision: input.readRevision, currentRevision: input.readRevision + 1 }
        : { kind: "denied", reason: "oversized_artifact" },
    })
    installDraft(controller)
    const setup = await renderExplorer(controller)

    try {
      await setup.waitForFrame((frame) => frame.includes("a.ts — Not in Context Pack"))
      await actAsync(() => setup.mockInput.pressEnter())
      expect(await setup.waitForFrame((frame) => frame.includes("Stale: draft changed"))).toContain("membership preserved")
      await actAsync(() => setup.mockInput.pressEnter())
      expect(await setup.waitForFrame((frame) => frame.includes("Denied: Oversized artifact"))).toContain("membership preserved")
      expect(controller.store.getState().contextPacks["claude-code"]?.draft?.selections).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})
