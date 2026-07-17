/** Captured-session whole-file membership over controller-owned repository discovery. */

import type { KeyEvent, MouseEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { ContextPackFileMembershipResult } from "../app/actions.ts"
import type { RepositoryFileList } from "../app/fileDiscovery.ts"
import type { ContextPackState, SessionId } from "../core/types.ts"
import { selectContextPack } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { usePalette } from "./theme.ts"

export const CONTEXT_PACK_FILE_EXPLORER_TITLE = "Context Pack File Explorer"
export const CONTEXT_PACK_FILE_EXPLORER_LOADING = "Loading safe repository files…"
export const CONTEXT_PACK_FILE_EXPLORER_EMPTY = "No safe repository files available."
export const CONTEXT_PACK_FILE_EXPLORER_UNAVAILABLE = "Repository files unavailable"
export const CONTEXT_PACK_FILE_EXPLORER_MISSING_DRAFT = "Membership unavailable — create a draft first."
export const CONTEXT_PACK_FILE_EXPLORER_SEALED_ONLY = "Membership unavailable — sealed pack is immutable; refine it first."
export const CONTEXT_PACK_FILE_EXPLORER_STALE = "Membership unavailable — draft freshness requires attention."
export const CONTEXT_PACK_FILE_EXPLORER_HINT = "↑↓ move  Enter/Space add or remove  Esc return to actions"
export const CONTEXT_PACK_FILE_EXPLORER_ROW_PREFIX = "context-pack-file-row-"
export const MAX_CONTEXT_PACK_FILE_ROWS = 8

type DiscoveryState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly paths: readonly string[] }
  | Extract<RepositoryFileList, { readonly kind: "unavailable" }>

export interface ContextPackFileExplorerProps {
  /** Exact session captured by the owning Context Pack panel. */
  readonly sessionId: SessionId
  /** Keyboard ownership is explicit so panel actions and explorer rows never react together. */
  readonly active?: boolean
  readonly onExit?: () => void
}

/** Key local discovery/navigation state by session; membership remains selector-owned. */
export function ContextPackFileExplorer(props: ContextPackFileExplorerProps): ReactNode {
  return <ContextPackFileExplorerBody key={props.sessionId} {...props} />
}

function ContextPackFileExplorerBody({
  sessionId,
  active = false,
  onExit = () => {},
}: ContextPackFileExplorerProps): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const packSelector = useMemo(() => selectContextPack(sessionId), [sessionId])
  const pack = useAppSelector(packSelector)
  const [discovery, setDiscovery] = useState<DiscoveryState>({ kind: "loading" })
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    let ignore = false
    setDiscovery({ kind: "loading" })
    setNotice(null)
    void controller.actions.listRepositoryFiles(sessionId).then(
      (result) => {
        if (ignore) return
        setDiscovery(result.kind === "ready"
          ? { kind: "ready", paths: [...result.paths].sort(compareLexically) }
          : result)
        setHighlightedIndex(0)
      },
      () => {
        if (!ignore) setDiscovery({ kind: "unavailable", reason: "discovery_failed" })
      },
    )
    return () => { ignore = true }
  }, [controller, sessionId])

  const paths = discovery.kind === "ready" ? discovery.paths : []
  const actionableReason = membershipBlockReason(pack)
  const actionable = actionableReason === null && paths.length > 0
  const boundedHighlight = Math.min(Math.max(highlightedIndex, 0), Math.max(paths.length - 1, 0))
  const windowStart = Math.min(
    Math.max(0, boundedHighlight - MAX_CONTEXT_PACK_FILE_ROWS + 1),
    Math.max(0, paths.length - MAX_CONTEXT_PACK_FILE_ROWS),
  )
  const visiblePaths = paths.slice(windowStart, windowStart + MAX_CONTEXT_PACK_FILE_ROWS)

  const activatePath = useCallback(async (path: string): Promise<void> => {
    if (pendingRef.current) return
    const draft = pack?.draft
    const blocked = membershipBlockReason(pack)
    if (!draft || blocked) {
      setNotice(blocked ?? CONTEXT_PACK_FILE_EXPLORER_MISSING_DRAFT)
      return
    }
    const selected = wholeFileSelection(pack, path) !== null
    pendingRef.current = true
    setNotice(`Pending: ${selected ? "Remove" : "Add"} ${path}`)
    const result = await controller.actions.mutateContextPackFileMembership({
      sessionId,
      path,
      readRevision: draft.revision,
      operation: selected ? "remove" : "add",
    })
    pendingRef.current = false
    setNotice(membershipResultLabel(path, result))
  }, [controller, pack, sessionId])

  const onKey = useCallback((key: KeyEvent): void => {
    if (!active || hasModifier(key)) return
    if (key.name === "escape") {
      key.preventDefault()
      onExit()
      return
    }
    if (!actionable || pendingRef.current) return
    if (key.name === "up") {
      key.preventDefault()
      setHighlightedIndex((current) => (current - 1 + paths.length) % paths.length)
      return
    }
    if (key.name === "down") {
      key.preventDefault()
      setHighlightedIndex((current) => (current + 1) % paths.length)
      return
    }
    if (["return", "kpenter", "space"].includes(key.name)) {
      key.preventDefault()
      const path = paths[boundedHighlight]
      if (path) void activatePath(path)
    }
  }, [actionable, activatePath, active, boundedHighlight, onExit, paths])
  useKeyboard(onKey)

  const status = discoveryStatus(discovery, pack)
  return (
    <box
      style={{
        flexDirection: "column",
        flexShrink: 0,
        border: true,
        borderColor: active ? palette.accent : palette.border,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={CONTEXT_PACK_FILE_EXPLORER_TITLE}
      titleColor={active ? palette.accent : palette.muted}
    >
      {status ? <text fg={palette.context.warn}>{status}</text> : null}
      {status === null ? visiblePaths.map((path, index) => {
        const pathIndex = windowStart + index
        const selected = wholeFileSelection(pack, path) !== null
        const highlighted = pathIndex === boundedHighlight
        const onMouseDown = (event: MouseEvent): void => {
          event.preventDefault()
          event.stopPropagation()
          setHighlightedIndex(pathIndex)
          if (!pendingRef.current) void activatePath(path)
        }
        return (
          <box
            id={`${CONTEXT_PACK_FILE_EXPLORER_ROW_PREFIX}${pathIndex}`}
            key={path}
            style={{ height: 1, flexShrink: 0, backgroundColor: highlighted && active ? palette.selectionSurface : undefined }}
            onMouseDown={onMouseDown}
          >
            <text fg={highlighted && active ? palette.text : palette.muted}>
              {`${highlighted && active ? "▸" : " "} ${path} — ${selected ? "In Context Pack · Remove from Context Pack" : "Not in Context Pack · Add to Context Pack"}`}
            </text>
          </box>
        )
      }) : null}
      {notice ? <text fg={notice.startsWith("Applied") ? palette.context.ok : palette.context.warn}>{notice}</text> : null}
      {active ? <text fg={palette.muted}>{CONTEXT_PACK_FILE_EXPLORER_HINT}</text> : null}
    </box>
  )
}

function discoveryStatus(discovery: DiscoveryState, pack: ContextPackState | null): string | null {
  if (discovery.kind === "loading") return CONTEXT_PACK_FILE_EXPLORER_LOADING
  if (discovery.kind === "unavailable") {
    return `${CONTEXT_PACK_FILE_EXPLORER_UNAVAILABLE} — ${humanizeReason(discovery.reason)}.`
  }
  if (discovery.paths.length === 0) return CONTEXT_PACK_FILE_EXPLORER_EMPTY
  return membershipBlockReason(pack)
}

function membershipBlockReason(pack: ContextPackState | null): string | null {
  if (!pack?.draft) {
    return pack?.sealed ? CONTEXT_PACK_FILE_EXPLORER_SEALED_ONLY : CONTEXT_PACK_FILE_EXPLORER_MISSING_DRAFT
  }
  return pack.draft.stale.kind === "stale" ? CONTEXT_PACK_FILE_EXPLORER_STALE : null
}

function wholeFileSelection(pack: ContextPackState | null, path: string) {
  return pack?.draft?.selections.find(
    (selection) => selection.kind === "full_file" && selection.path === path,
  ) ?? null
}

function membershipResultLabel(path: string, result: ContextPackFileMembershipResult): string {
  switch (result.kind) {
    case "applied":
      return `Applied: ${result.operation === "add" ? "Added" : "Removed"} ${path}`
    case "stale":
      return `Stale: draft changed from revision ${result.readRevision} to ${result.currentRevision}; membership preserved.`
    case "denied":
      return `Denied: ${humanizeReason(result.reason)}; membership preserved.`
  }
}

function compareLexically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function hasModifier(key: KeyEvent): boolean {
  return key.ctrl || key.meta || key.shift
}

function humanizeReason(reason: string): string {
  const words = reason.replaceAll("_", " ").replaceAll("-", " ")
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}
