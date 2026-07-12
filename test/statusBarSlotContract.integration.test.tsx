import { describe, expect, it } from "bun:test"
import { useMemo } from "react"

import { testRender } from "@opentui/react/test-utils"

import type { SessionId } from "../src/core/types.ts"
import { createAppStore, type AppState } from "../src/store/appStore.ts"
import {
  selectSessionBranch,
  selectSessionContext,
  selectSessionModel,
} from "../src/store/selectors.ts"
import { destroyMounted } from "./reactTui.ts"

// Suite: status-bar slot contract integration
// Invariant: a selector-consuming bar renders real branch data and no absent delegated slots.
// Boundary IN: selector factories, React memoization, and OpenTUI conditional rendering.
// Boundary OUT: the production StatusStrip layout, owned by task_11 and StatusStrip.test.tsx.

interface SlotBarProps {
  sessionId: SessionId
  state: AppState
}

function SlotBar({ sessionId, state }: SlotBarProps) {
  const branchSelector = useMemo(() => selectSessionBranch(sessionId), [sessionId])
  const modelSelector = useMemo(() => selectSessionModel(sessionId), [sessionId])
  const contextSelector = useMemo(() => selectSessionContext(sessionId), [sessionId])
  const branch = branchSelector(state)
  const model = modelSelector(state)
  const context = contextSelector(state)

  return (
    <box flexDirection="row">
      {branch === null ? null : <text>{`branch ${branch}`}</text>}
      {model === null ? null : <text>{`model ${model}`}</text>}
      {context === null ? null : <text>{`context ${context.percent}`}</text>}
    </box>
  )
}

describe("status-bar slot contract integration", () => {
  it("renders the branch slot and omits unavailable model and context slots", async () => {
    const base = createAppStore().getState()
    const state: AppState = {
      ...base,
      sessions: {
        ...base.sessions,
        "claude-code": { ...base.sessions["claude-code"]!, branch: "feature/status-bar" },
      },
    }
    const { renderer, waitForFrame } = await testRender(
      <SlotBar sessionId="claude-code" state={state} />,
      { width: 80, height: 1 },
    )

    const frame = await waitForFrame((next) => next.includes("branch feature/status-bar"))
    expect(frame).toContain("branch feature/status-bar")
    expect(frame).not.toContain("model")
    expect(frame).not.toContain("context")

    await destroyMounted(renderer)
  })
})
