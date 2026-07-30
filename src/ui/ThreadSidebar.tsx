/**
 * Persistent project/thread navigation inspired by T3 Code nightly's Sidebar V2.
 *
 * Kitten already owns conversation lifecycle in the external store. This view is
 * deliberately only a projection of that state: it groups threads by their session
 * cwd, shows provider and execution standing, and routes every mutation through
 * ControllerActions. It never owns a connection or writes session state.
 */

import type { MouseEvent } from "@opentui/core"
import { type ReactNode } from "react"

import {
  type ProviderKind,
  type SessionStatus,
} from "../core/types.ts"
import type { SessionListItem } from "../store/selectors.ts"
import { usePalette } from "./theme.ts"

export const THREAD_SIDEBAR_WIDTH = 36
export const THREAD_SIDEBAR_DEFAULT_BREAKPOINT = 121
export const THREAD_SIDEBAR_TITLE = "Threads"
export const THREAD_SIDEBAR_NEW_THREAD_LABEL = "New thread"
export const THREAD_SIDEBAR_FOCUS_HINT = "↑↓ move · Enter open · Esc leave"
export const THREAD_SIDEBAR_IDLE_HINT = "F3 focus · /new create"

const STATUS_LABELS: Readonly<Record<SessionStatus, string>> = {
  idle: "Idle",
  working: "Working",
  awaiting_clarification: "Input",
  awaiting_approval: "Approval",
  finished: "Done",
  error: "Failed",
}

const PROVIDER_LABELS: Readonly<Record<ProviderKind, string>> = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor",
}

export interface ThreadSidebarProject {
  readonly cwd: string
  readonly label: string
  readonly threads: readonly SessionListItem[]
}

/** Cross-platform final path component without trusting the host path flavor. */
export function projectLabelFromCwd(cwd: string): string {
  const normalized = cwd.replaceAll("\\", "/").replace(/\/+$/, "")
  const label = normalized.slice(normalized.lastIndexOf("/") + 1).trim()
  return label || cwd
}

/**
 * Preserve workspace order while grouping threads by exact project cwd.
 *
 * Equal folder names get a parent-path suffix so two repositories named `app`
 * remain distinguishable without making every ordinary header noisy.
 */
export function groupThreadsByProject(
  threads: readonly SessionListItem[],
): readonly ThreadSidebarProject[] {
  const byCwd = new Map<string, SessionListItem[]>()
  for (const thread of threads) {
    const group = byCwd.get(thread.cwd)
    if (group) group.push(thread)
    else byCwd.set(thread.cwd, [thread])
  }

  const baseCounts = new Map<string, number>()
  for (const cwd of byCwd.keys()) {
    const base = projectLabelFromCwd(cwd)
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
  }

  return [...byCwd.entries()].map(([cwd, projectThreads]) => {
    const base = projectLabelFromCwd(cwd)
    return {
      cwd,
      label: baseCounts.get(base) === 1 ? base : `${base} · ${cwd}`,
      threads: projectThreads,
    }
  })
}

/** Monochrome-readable row text; color supplements rather than carries status. */
export function threadSidebarRowLabel(thread: SessionListItem): string {
  return `${thread.label}  ${threadSidebarMetadataLabel(thread)}`
}

/** Compact second-line metadata keeps the thread title visually dominant. */
export function threadSidebarMetadataLabel(thread: SessionListItem): string {
  const lifecycle = thread.lifecycle === "background" ? "bg" : STATUS_LABELS[thread.status]
  return `${PROVIDER_LABELS[thread.providerKind]} · ${lifecycle}`
}

export interface ThreadSidebarProps {
  readonly threads: readonly SessionListItem[]
  readonly cursorId: string | null
  readonly focused: boolean
  readonly onThread: (session: SessionListItem) => void
  readonly onNewThread: () => void
}

/** Always-mounted-at-wide-width navigator; interaction ownership stays in CockpitFrame. */
export function ThreadSidebar({
  threads,
  cursorId,
  focused,
  onThread,
  onNewThread,
}: ThreadSidebarProps): ReactNode {
  const palette = usePalette()
  const projects = groupThreadsByProject(threads)

  return (
    <box
      style={{
        width: THREAD_SIDEBAR_WIDTH,
        flexShrink: 0,
        flexDirection: "column",
        border: ["right"],
        borderColor: focused ? palette.accent : palette.border,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
    >
      <box
        style={{
          height: 1,
          flexShrink: 0,
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <text fg={palette.text} attributes={1}>{THREAD_SIDEBAR_TITLE}</text>
        <text fg={palette.muted}>
          {`${threads.length} ${threads.length === 1 ? "thread" : "threads"}`}
        </text>
      </box>
      <box
        style={{
          height: 1,
          flexShrink: 0,
          flexDirection: "row",
        }}
        onMouseDown={(event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          onNewThread()
        }}
      >
        <text fg={palette.text}>
          <span fg={palette.accent} attributes={1}>+ </span>
          {THREAD_SIDEBAR_NEW_THREAD_LABEL}
        </text>
      </box>

      <scrollbox
        style={{ flexGrow: 1, flexShrink: 1 }}
        scrollX={false}
        horizontalScrollbarOptions={{ visible: false }}
      >
        {projects.length === 0 ? (
          <text fg={palette.muted}>No threads yet.</text>
        ) : projects.map((project, projectIndex) => (
          <box
            key={project.cwd}
            style={{
              flexDirection: "column",
              flexShrink: 0,
              marginTop: projectIndex === 0 ? 0 : 1,
            }}
          >
            <box
              style={{
                height: 1,
                flexShrink: 0,
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <text fg={palette.muted} attributes={1} wrapMode="none">
                {project.label}
              </text>
              <text fg={palette.muted}>{project.threads.length}</text>
            </box>
            {project.threads.map((thread) => (
              <ThreadSidebarRow
                key={thread.id}
                thread={thread}
                highlighted={focused ? cursorId === thread.id : thread.selected}
                onThread={onThread}
              />
            ))}
          </box>
        ))}
      </scrollbox>

      <text style={{ height: 1, flexShrink: 0 }} fg={palette.muted} wrapMode="none">
        {focused ? THREAD_SIDEBAR_FOCUS_HINT : THREAD_SIDEBAR_IDLE_HINT}
      </text>
    </box>
  )
}

function ThreadSidebarRow({
  thread,
  highlighted,
  onThread,
}: {
  readonly thread: SessionListItem
  readonly highlighted: boolean
  readonly onThread: (session: SessionListItem) => void
}): ReactNode {
  const palette = usePalette()
  const marker = thread.selected
    ? "›"
    : thread.needsAttention && !thread.attentionSeen
      ? "!"
      : thread.lifecycle === "background"
        ? "○"
        : " "

  return (
    <box
      style={{
        height: 2,
        flexShrink: 0,
        flexDirection: "column",
        paddingLeft: 1,
        backgroundColor: highlighted ? palette.selectionSurface : undefined,
      }}
      onMouseDown={(event: MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        onThread(thread)
      }}
    >
      <text fg={palette.text} attributes={highlighted ? 1 : 0} wrapMode="none">
        <span fg={thread.needsAttention ? palette.status[thread.status] : palette.muted}>
          {`${marker} `}
        </span>
        {thread.label}
      </text>
      <text style={{ paddingLeft: 2 }} fg={palette.muted} wrapMode="none">
        <span fg={palette.muted}>{`${PROVIDER_LABELS[thread.providerKind]} · `}</span>
        <span fg={palette.status[thread.status]}>
          {thread.lifecycle === "background" ? "bg" : STATUS_LABELS[thread.status]}
        </span>
      </text>
    </box>
  )
}
