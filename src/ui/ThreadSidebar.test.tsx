import { describe, expect, it } from "bun:test"

import type { SessionListItem } from "../store/selectors.ts"
import {
  groupThreadsByProject,
  projectLabelFromCwd,
  threadSidebarMetadataLabel,
  threadSidebarRowLabel,
} from "./ThreadSidebar.tsx"

function thread(
  id: string,
  cwd: string,
  overrides: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id,
    title: id,
    label: id,
    providerKind: "codex",
    cwd,
    status: "idle",
    needsAttention: false,
    lifecycle: "visible",
    selected: false,
    attentionSeen: true,
    delegation: null,
    review: null,
    ...overrides,
  }
}

describe("projectLabelFromCwd", () => {
  it("handles POSIX and Windows-style project paths", () => {
    expect(projectLabelFromCwd("/work/kitten/")).toBe("kitten")
    expect(projectLabelFromCwd("C:\\work\\kitten")).toBe("kitten")
  })
})

describe("groupThreadsByProject", () => {
  it("preserves project and thread order while grouping exact cwd identities", () => {
    const groups = groupThreadsByProject([
      thread("first", "/work/alpha"),
      thread("second", "/work/beta"),
      thread("third", "/work/alpha"),
    ])

    expect(groups.map((group) => group.cwd)).toEqual(["/work/alpha", "/work/beta"])
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["first", "third"])
  })

  it("disambiguates equal repository folder names with the exact cwd", () => {
    const groups = groupThreadsByProject([
      thread("one", "/clients/one/app"),
      thread("two", "/clients/two/app"),
    ])

    expect(groups.map((group) => group.label)).toEqual([
      "app · /clients/one/app",
      "app · /clients/two/app",
    ])
  })
})

describe("threadSidebarRowLabel", () => {
  it("keeps provider and status legible without color", () => {
    expect(threadSidebarRowLabel(thread("refactor", "/work", {
      label: "Refactor auth",
      providerKind: "claude-code",
      status: "working",
    }))).toBe("Refactor auth  claude · Working")
  })

  it("uses the lifecycle cue for parked background work", () => {
    expect(threadSidebarRowLabel(thread("parked", "/work", {
      providerKind: "cursor",
      status: "finished",
      lifecycle: "background",
    }))).toBe("parked  cursor · bg")
  })

  it("separates compact provider/status metadata from the dominant title", () => {
    expect(threadSidebarMetadataLabel(thread("refactor", "/work", {
      providerKind: "claude-code",
      status: "awaiting_clarification",
    }))).toBe("claude · Input")
  })
})
