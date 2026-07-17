import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { evaluateExplorePolicy, type ExplorePolicySnapshot } from "../core/explorePolicy.ts"
import type { ManagedWorktreeBinding, SessionSeed, SessionStatus } from "../core/types.ts"
import { createAppStore, type AppStore } from "../store/appStore.ts"
import {
  EXPLORE_RESTRICTION_SUMMARY,
  selectVisibleTabs,
  type ExplorePolicyPresentation,
  type ManagedWorktreeReviewPresentation,
  type WorkspaceConversationView,
} from "../store/selectors.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  layoutTabStrip,
  SHARED_WORKSPACE_LABEL,
  NEW_TAB_LABEL,
  TAB_MARKER,
  TAB_OVERFLOW_LABEL,
  TAB_SELECTED_MARKER,
  TabWorkspace,
  tabItemLabel,
} from "./TabWorkspace.tsx"

function pointOf(frame: string, text: string): { x: number; y: number } {
  const lines = frame.replace(/\n$/, "").split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  if (y < 0) throw new Error(`Could not find ${text} in frame`)
  return { x: lines[y]!.indexOf(text) + 1, y }
}

function view(id: string, selected = false): WorkspaceConversationView {
  return {
    id,
    displayName: id,
    label: id,
    lifecycle: "visible",
    providerKind: "codex",
    cwd: `/work/${id}`,
    status: "idle",
    selected,
    needsAttention: false,
    attentionSeen: true,
    availability: { kind: "ready" },
    teardownState: "open",
    duplicateIndex: 1,
    duplicateCount: 1,
    sharedWorkspaceCount: 1,
    delegation: null,
    review: null,
    contextPackAttention: null,
  }
}

function markContextReady(store: AppStore, sessionId: string): void {
  const prepared = store.prepareContextBuild(sessionId, {
    kind: "start_fresh",
    original: `Prepare ${sessionId}`,
  }, {
    parentId: sessionId,
    childId: `builder-${sessionId}`,
    parentGeneration: 1,
    childGeneration: 1,
  })
  if (prepared.kind !== "prepared") throw new Error("expected prepared Context Build")
  if (!store.settleContextBuild(sessionId, prepared.binding, "ready_for_review")) {
    throw new Error("expected settled Context Build")
  }
}

const EXPLORE_PRESENTATION: ExplorePolicyPresentation = {
  role: "explore",
  roleLabel: "explore",
  compactLabel: "explore",
  restrictionSummary: EXPLORE_RESTRICTION_SUMMARY,
  attestationVersion: "tab-ui-v1",
  confirmed: { provider: "codex", model: "safe-model", effort: "medium" },
}

function review(
  availability: ManagedWorktreeReviewPresentation["availability"] = "available",
): ManagedWorktreeReviewPresentation {
  return {
    kind: "managed-worktree",
    managed: true,
    managedLabel: "Managed worktree",
    provenance: "kitten-managed",
    provenanceLabel: "Kitten-managed workspace",
    worktreePath: "/repo/.kitten/worktrees/child",
    branch: "kitten/child",
    baseBranch: "main",
    baseSha: "0123456789abcdef",
    availability,
    availabilityLabel: availability === "available" ? "Review available" : "Review unavailable",
    reason: availability === "unavailable" ? "missing" : null,
    reasonLabel: availability === "unavailable" ? "Managed workspace is missing" : null,
  }
}

function managedBinding(
  ownerSessionId: string,
  availability: ManagedWorktreeBinding["availability"],
): ManagedWorktreeBinding {
  return {
    kind: "managed",
    id: `binding-${ownerSessionId}`,
    repoRoot: "/repo",
    worktreePath: `/repo/.kitten/worktrees/${ownerSessionId}`,
    branch: `kitten/${ownerSessionId}`,
    baseBranch: "main",
    baseSha: "0123456789abcdef",
    ownerSessionId,
    availability,
    ...(availability === "unavailable" ? { reason: "missing" as const } : {}),
  }
}

function acceptedExplorePolicy(): ExplorePolicySnapshot {
  const decision = evaluateExplorePolicy({
    role: "explore",
    restrictions: {
      filesystem: "read-only",
      shell: false,
      externalMcp: false,
      agentControl: false,
      askUser: true,
      maxDepth: 0,
    },
    limits: { perParent: 2, global: 4 },
    attestationVersion: "tab-ui-v1",
    confirmed: { provider: "codex", model: "safe-model", effort: "medium" },
  })
  if (decision.kind !== "eligible") throw new Error("explore policy fixture must be eligible")
  return decision.policy
}

function fleet(count: number, sameCwd = false): { seeds: SessionSeed[]; runtimes: AgentRuntimeState[] } {
  const seeds: SessionSeed[] = Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    providerKind: index % 2 === 0 ? "claude-code" : "codex",
    title: `Session ${index + 1}`,
    cwd: sameCwd ? "/work/shared" : `/work/${index + 1}`,
  }))
  return {
    seeds,
    runtimes: seeds.map((seed) => ({
      sessionId: seed.id,
      providerKind: seed.providerKind,
      displayName: seed.title,
      title: seed.title,
      cwd: seed.cwd,
      ready: true,
      acpSessionId: `acp-${seed.id}`,
    })),
  }
}

async function renderStrip(controller: FakeController, width = 120) {
  const setup = await testRender(
    <CockpitProvider controller={controller}><TabWorkspace /></CockpitProvider>,
    { width, height: 4, kittyKeyboard: true },
  )
  await setup.renderOnce()
  return setup
}

describe("TabWorkspace presentation", () => {
  it("adds one selector-provided managed cue while leaving an ordinary child label unchanged", () => {
    const managed = view("managed")
    managed.review = review()
    const ordinary = view("ordinary")
    ordinary.delegation = {
      kind: "child",
      parentId: "parent",
      parentLabel: "Parent",
      lineageLabel: "Child of Parent",
      status: "running",
      statusLabel: "Running",
      terminalTranscriptAvailable: false,
      explore: null,
    }

    expect(tabItemLabel(managed)).toBe("[tab] managed · idle · Managed worktree")
    expect(tabItemLabel(ordinary)).toBe("[tab] ordinary · idle · Child of Parent · Running")
  })

  it("uses selector-owned terminal and unavailable review labels without detailed binding identity", () => {
    const terminal = view("terminal")
    terminal.review = review()
    terminal.delegation = {
      kind: "child",
      parentId: "parent",
      parentLabel: "Parent",
      lineageLabel: "Child of Parent",
      status: "finished",
      statusLabel: "Finished",
      terminalTranscriptAvailable: true,
      explore: null,
    }
    const unavailable = view("unavailable")
    unavailable.review = review("unavailable")

    expect(tabItemLabel(terminal)).toContain(" · Review available")
    expect(tabItemLabel(unavailable)).toContain(" · Review unavailable")
    for (const label of [tabItemLabel(terminal), tabItemLabel(unavailable)]) {
      expect(label).not.toContain("/repo")
      expect(label).not.toContain("kitten/child")
      expect(label).not.toContain("0123456789abcdef")
      expect(label).not.toContain("Managed workspace is missing")
    }
  })

  it("adds only the selector-provided compact explore cue to an active child label", () => {
    const child = view("child")
    child.delegation = {
      kind: "child",
      parentId: "parent",
      parentLabel: "Parent",
      lineageLabel: "Child of Parent",
      status: "running",
      statusLabel: "Running",
      terminalTranscriptAvailable: false,
      explore: EXPLORE_PRESENTATION,
    }

    expect(tabItemLabel(child)).toBe("[tab] child · idle · Child of Parent · Running · explore")
  })

  it.each([
    ["running", "Running", false],
    ["needs_input", "Needs input", false],
    ["finished", "Finished", true],
    ["failed", "Failed", true],
    ["cancelled", "Cancelled", true],
  ] as const)("renders delegated %s as selector-provided text", (status, label, terminal) => {
    const child = view("child")
    child.delegation = {
      kind: "child",
      parentId: "parent",
      parentLabel: "Parent",
      lineageLabel: "Child of Parent",
      status,
      statusLabel: label,
      terminalTranscriptAvailable: terminal,
      explore: null,
    }

    expect(tabItemLabel(child)).toContain("Child of Parent")
    expect(tabItemLabel(child)).toContain(label)
  })

  it("shows a selected parent's active delegated group without losing overflow access", async () => {
    const { seeds, runtimes } = fleet(2)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    controller.store.addDelegatedSession({
      seed: { id: "child", providerKind: "claude-code", title: "Research", cwd: "/work/child" },
      parentId: "s1",
      parentGeneration: 1,
      childGeneration: 1,
      task: "Research the selector seam",
      desiredOutcome: "Return the constraints",
    })
    controller.store.publishDelegatedChildState({
      parentId: "s1",
      childId: "child",
      parentGeneration: 1,
      childGeneration: 1,
      status: "running",
      sessionStatus: "working",
    })

    const setup = await renderStrip(controller, 90)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Group active")
    expect(frame).toContain(TAB_OVERFLOW_LABEL)
    await destroyMounted(setup.renderer)
  })

  it("identifies a reopened delegated child and retains its Running lifecycle", async () => {
    const { seeds, runtimes } = fleet(1)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    controller.store.addDelegatedSession({
      seed: { id: "child", providerKind: "codex", title: "Research", cwd: "/work/child" },
      parentId: "s1",
      parentGeneration: 1,
      childGeneration: 1,
      task: "Research the selector seam",
      desiredOutcome: "Return the constraints",
    })
    controller.store.publishDelegatedChildState({
      parentId: "s1",
      childId: "child",
      parentGeneration: 1,
      childGeneration: 1,
      status: "running",
      sessionStatus: "working",
    })
    controller.store.reopenConversation("child")

    const setup = await renderStrip(controller, 120)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Child of Session 1")
    expect(frame).toContain("Running")
    await destroyMounted(setup.renderer)
  })

  it("shows an active explore child in the mounted tab strip and preserves mouse focus movement", async () => {
    const { seeds, runtimes } = fleet(1)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    controller.store.addDelegatedSession({
      seed: { id: "child", providerKind: "codex", title: "Research", cwd: "/work/child" },
      parentId: "s1",
      parentGeneration: 1,
      childGeneration: 1,
      task: "Research the selector seam",
      desiredOutcome: "Return the constraints",
      policy: acceptedExplorePolicy(),
    })
    controller.store.publishDelegatedChildState({
      parentId: "s1",
      childId: "child",
      parentGeneration: 1,
      childGeneration: 1,
      status: "running",
      sessionStatus: "working",
    })
    controller.store.reopenConversation("child")
    const setup = await renderStrip(controller, 180)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Child of Session 1 · Running · explore")
    const point = pointOf(frame, `${TAB_MARKER} Session 1`)
    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("s1")
    await destroyMounted(setup.renderer)
  })

  it("renders workspace order with selected and non-color status cues", async () => {
    const { seeds, runtimes } = fleet(5)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    const statuses: SessionStatus[] = ["idle", "working", "awaiting_approval", "error", "finished"]
    statuses.forEach((status, index) => controller.store.applyEvent(`s${index + 1}`, { kind: "status", status }))
    const setup = await renderStrip(controller, 240)
    const frame = setup.captureCharFrame()

    expect(frame.indexOf("Session 1")).toBeLessThan(frame.indexOf("Session 5"))
    expect(frame).toContain(TAB_SELECTED_MARKER)
    expect(frame).toContain(TAB_MARKER)
    expect(frame).toContain(NEW_TAB_LABEL)
    for (const cue of ["idle", "working", "approval", "error", "finished"]) expect(frame).toContain(cue)

    await destroyMounted(setup.renderer)
  })

  it("renders background completion on its owning tab without moving focus or overlays", async () => {
    const { seeds, runtimes } = fleet(2)
    const store = createAppStore({ seeds, selectedVisibleId: "s1" })
    store.setFocusedPane({ kind: "agent", sessionId: "s1" })
    store.openSettings()
    const controller = createFakeController({ store, runtimes })
    const selectedVisibleId = store.getState().workspace.selectedVisibleId
    const focusedPane = store.getState().focusedPane
    const overlays = store.getState().overlays
    const sessionStatus = store.getState().sessions.s2?.status
    const agentAttention = store.getState().workspace.conversations.s2?.attention

    markContextReady(store, "s2")
    const setup = await renderStrip(controller, 180)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Session 2 · idle · Context ready")
    expect(store.getState().workspace.selectedVisibleId).toBe(selectedVisibleId)
    expect(store.getState().focusedPane).toBe(focusedPane)
    expect(store.getState().overlays).toBe(overlays)
    expect(store.getState().sessions.s2?.status).toBe(sessionStatus)
    expect(store.getState().workspace.conversations.s2?.attention).toBe(agentAttention)
    expect(controller.calls.reviewContextPack).toEqual([])
    await destroyMounted(setup.renderer)
  })

  it("acknowledges only the owning cue on explicit tab selection without opening review", async () => {
    const { seeds, runtimes } = fleet(2)
    const store = createAppStore({ seeds, selectedVisibleId: "s1" })
    markContextReady(store, "s2")
    const sessionStatus = store.getState().sessions.s2?.status
    const agentAttention = store.getState().workspace.conversations.s2?.attention
    const controller = createFakeController({ store, runtimes })
    const setup = await renderStrip(controller, 180)
    const point = pointOf(setup.captureCharFrame(), `${TAB_MARKER} Session 2`)

    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
    await setup.renderOnce()

    expect(store.getState().workspace.selectedVisibleId).toBe("s2")
    expect(store.getState().contextPacks.s2?.attention).toBeUndefined()
    expect(store.getState().contextPacks.s2?.review).toBeNull()
    expect(store.getState().sessions.s2?.status).toBe(sessionStatus)
    expect(store.getState().workspace.conversations.s2?.attention).toBe(agentAttention)
    expect(controller.calls.reviewContextPack).toEqual([])
    expect(setup.captureCharFrame()).not.toContain("Context ready")
    await destroyMounted(setup.renderer)
  })

  it("keeps agent attention ordering and jump behavior independent from Context Pack cues", () => {
    const { seeds, runtimes } = fleet(5)
    const store = createAppStore({ seeds, selectedVisibleId: "s1" })
    markContextReady(store, "s2")
    store.applyEvent("s3", { kind: "status", status: "finished" })
    store.applyEvent("s4", { kind: "status", status: "error" })
    store.applyEvent("s5", { kind: "status", status: "awaiting_approval" })
    const controller = createFakeController({ store, runtimes })

    controller.actions.jumpToNextAttention()
    expect(store.getState().workspace.selectedVisibleId).toBe("s5")
    controller.actions.jumpToNextAttention()
    expect(store.getState().workspace.selectedVisibleId).toBe("s4")
    controller.actions.jumpToNextAttention()
    expect(store.getState().workspace.selectedVisibleId).toBe("s3")
    expect(store.getState().contextPacks.s2?.attention).toBe("ready_for_review")
  })

  it("shows deterministic duplicate labels and shared-workspace cues from selectors", async () => {
    const { seeds, runtimes } = fleet(2, true)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    controller.store.renameConversation("s1", "Build")
    controller.store.renameConversation("s2", "Build")
    const setup = await renderStrip(controller)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Build (1)")
    expect(frame).toContain("Build (2)")
    expect(frame.split(`${SHARED_WORKSPACE_LABEL}×2`)).toHaveLength(3)

    await destroyMounted(setup.renderer)
  })

  it("selects exactly one mouse-down target through ControllerActions", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)
    const point = pointOf(setup.captureCharFrame(), `${TAB_MARKER} Codex`)

    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))

    expect(controller.calls.selectConversation).toEqual(["codex"])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    await destroyMounted(setup.renderer)
  })

  it("keeps a selected tab, never wraps, and exposes hidden work through overflow", () => {
    const tabs = [view("one"), view("two"), view("three", true), view("four")]
    const layout = layoutTabStrip(tabs, 50, 1)

    expect(layout.visible.some((tab) => tab.id === "three")).toBe(true)
    expect(layout.visible.length).toBeLessThan(tabs.length)
    expect(layout.hiddenCount).toBe(tabs.length - layout.visible.length)
    expect(layout.overflowLabel).toContain(TAB_OVERFLOW_LABEL)
    expect(layout.overflowLabel).toContain("bg 1")
    expect(layout.newTabVisible).toBeFalse()
  })

  it("keeps selected and overflow reachability unchanged when an explore cue consumes width", () => {
    const tabs = [view("one"), view("two", true), view("three")]
    tabs[1]!.delegation = {
      kind: "child",
      parentId: "parent",
      parentLabel: "Parent",
      lineageLabel: "Child of Parent",
      status: "running",
      statusLabel: "Running",
      terminalTranscriptAvailable: false,
      explore: EXPLORE_PRESENTATION,
    }

    const layout = layoutTabStrip(tabs, 95, 1)
    expect(layout.visible.some((tab) => tab.id === "two")).toBe(true)
    expect(layout.overflowLabel).toContain(TAB_OVERFLOW_LABEL)
    expect(layout.overflowLabel).toContain("bg 1")
  })

  it("renders an unavailable selector projection compactly while Sessions remains discoverable", async () => {
    const binding = managedBinding("managed", "unavailable")
    const seeds: SessionSeed[] = [
      {
        id: "managed",
        providerKind: "codex",
        title: "Managed child",
        cwd: binding.worktreePath,
        worktreeBinding: binding,
      },
      { id: "sibling", providerKind: "claude-code", title: "Sibling", cwd: "/repo" },
    ]
    const runtimes: AgentRuntimeState[] = seeds.map((seed) => ({
      sessionId: seed.id,
      providerKind: seed.providerKind,
      displayName: seed.title,
      title: seed.title,
      cwd: seed.cwd,
      ready: true,
      acpSessionId: `acp-${seed.id}`,
    }))
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    const setup = await renderStrip(controller, 70)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Review unavailable")
    expect(frame).toContain(TAB_OVERFLOW_LABEL)
    expect(frame).not.toContain(binding.worktreePath)
    expect(frame).not.toContain(binding.branch)
    expect(frame).not.toContain(binding.baseSha)
    await destroyMounted(setup.renderer)
  })

  it("renders an available terminal selector projection as review-ready text", async () => {
    const binding = managedBinding("managed", "available")
    const seed: SessionSeed = {
      id: "managed",
      providerKind: "codex",
      title: "Managed child",
      cwd: binding.worktreePath,
      worktreeBinding: binding,
    }
    const store = createAppStore({ seeds: [seed] })
    store.applyEvent(seed.id, { kind: "status", status: "finished" })
    const controller = createFakeController({
      store,
      runtimes: [{
        sessionId: seed.id,
        providerKind: seed.providerKind,
        displayName: seed.title,
        title: seed.title,
        cwd: seed.cwd,
        ready: true,
        acpSessionId: "acp-managed",
      }],
    })
    const setup = await renderStrip(controller, 100)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("Review available")
    expect(frame).not.toContain(binding.worktreePath)
    expect(frame).not.toContain(binding.branch)
    expect(frame).not.toContain(binding.baseSha)
    await destroyMounted(setup.renderer)
  })

  it("does not publish a tab-list change when only transcript content streams", () => {
    const controller = createFakeController()
    let notifications = 0
    const stop = controller.store.subscribeSelector(selectVisibleTabs, () => notifications++)

    controller.store.applyEvent("codex", { kind: "agent_message", messageId: "m1", textDelta: "stream" })

    expect(notifications).toBe(0)
    stop()
  })

  it("creates a new tab from the visible tab-strip affordance", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)
    const point = pointOf(setup.captureCharFrame(), NEW_TAB_LABEL)

    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
    await setup.waitFor(() => controller.calls.createConversation === 1)

    expect(controller.store.getState().workspace.selectedVisibleId).toBe("fake-created-1")
    await destroyMounted(setup.renderer)
  })
})

describe("mounted cockpit tab navigation", () => {
  it("keeps visible tabs in the cockpit frame with direct mouse navigation", async () => {
    const { seeds, runtimes } = fleet(4)
    const controller = createFakeController({ store: createAppStore({ seeds }), runtimes })
    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: 240,
      height: 20,
      kittyKeyboard: true,
    })

    const cockpit = await setup.waitForFrame((frame) => frame.includes("Kitten"))
    expect(cockpit).toContain(`${TAB_SELECTED_MARKER} Session 1`)
    expect(cockpit).toContain(`${TAB_MARKER} Session 2`)

    const point = pointOf(cockpit, `${TAB_MARKER} Session 2`)
    await actAsync(async () => setup.mockMouse.pressDown(point.x, point.y))
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("s2")
    expect(controller.calls.selectConversationOptions).toEqual([{ source: "mouse" }])

    await destroyMounted(setup.renderer)
  })
})
