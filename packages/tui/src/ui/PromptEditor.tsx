/**
 * The composer: where the developer writes to whichever agent has focus.
 *
 * Everything the editor does reaches an agent through `controller.actions` and
 * nothing else (ADR-003). Submitting calls `sendPrompt` while idle or `steer` during
 * an active turn; Escape remains the distinct hard-stop action. The editor holds no draft in React state - the textarea's
 * own edit buffer is the draft, read once on submit - so a keystroke repaints the
 * renderable without waking the reconciler.
 *
 * Key precedence is the framework's, not ours. The shell's global `useKeyboard`
 * listeners run before any focused renderable sees a key, so the help overlay can
 * `preventDefault()` Escape and the editor never fires. What the shell leaves alone
 * reaches this textarea: printable characters, Enter and Shift+Enter (rebound in
 * `PROMPT_KEY_BINDINGS`), and Escape.
 *
 * The editor gives up terminal focus while the shell or a modal overlay owns the
 * keyboard, and takes it back when the agent pane returns. That is not cosmetic:
 * OpenTUI tracks exactly one focused renderable, so the composer must not keep a cursor
 * while shell bytes or preview edits are routed elsewhere. Its draft survives because
 * blurring the textarea does not clear its edit buffer.
 *
 * Bracketed paste never travels the keypress path at all. OpenTUI's stdin parser
 * accumulates everything between the paste markers - across as many stdin chunks as
 * a large paste takes - and hands the textarea one `PasteEvent`, which it inserts
 * whole after stripping ANSI. A pasted newline is therefore text, not a submit.
 */

import type { EditBufferRenderable, KeyEvent, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import type { AvailableCommand, SessionId } from "../core/types.ts"
import {
  selectFocusedSessionId,
  selectHasOpenOverlay,
  selectIsShellFocused,
  selectRestoration,
  selectRestorationBundle,
  selectSessionCommands,
  selectSessionPostInterruptContinuationRecovery,
  selectSessionPostInterruptContinuationStatus,
  selectSessionPromptHistory,
  selectSessionSteeringRecovery,
  selectSessionSteeringStatus,
  selectSessionStatus,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { FileSelector, type FileSelectorStatus } from "./FileSelector.tsx"
import {
  clearPendingFileReferencesOnSubmit,
  fileTokenAt,
  formatFileReference,
  isFileTokenSuppressed,
  rankFileMatches,
  suppressFileToken,
  updateFileTokenSuppression,
  updatePendingFileReferences,
  visibleFileMatches,
  type FileToken,
  type FileTokenSuppression,
  type PendingFileReference,
} from "./fileCompletion.ts"
import {
  COCKPIT_COMMANDS,
  COCKPIT_KEYMAP,
  matchMenuCommand,
  PROMPT_KEY_BINDINGS,
  type CockpitCommand,
} from "./keymap.ts"
import { SlashMenu, type MenuRow, type SlashMenuGroup } from "./SlashMenu.tsx"
import { usePalette } from "./theme.ts"

/** The composer's only visible title is a temporary prompt-history position. */
export const PROMPT_HISTORY_TITLE = "History"

/** The empty-editor hint while the focused agent is ready. */
export const PROMPT_PLACEHOLDER = "Enter sends, Shift+Enter adds a line, Esc interrupts"

/** The empty-editor hint that distinguishes active steering from a hard stop. */
export const PROMPT_STEERING_PLACEHOLDER = "Enter steers active task, Esc stops it"

/** The empty-editor hint while the focused agent is not ready. */
export const PROMPT_DISABLED_PLACEHOLDER = "Switch to a ready agent to send a prompt"

/** The empty-workspace title is explicit without occupying the composer label. */
export const PROMPT_WORKSPACE_TITLE = "Select a conversation"

/** Empty-workspace feedback shown in place of an editable input. */
export const PROMPT_WORKSPACE_PLACEHOLDER = "Select a visible conversation to send a prompt"

/** The composer's visual prompt marker. */
export const PROMPT_CHEVRON = "❯"

const NOOP_RUN_COMMAND = (_command: CockpitCommand): void => {}

/**
 * How tall the editor is when empty.
 *
 * More than one row, because the height tracks *logical* lines: a single long
 * sentence wraps into several visual rows that the editor cannot count in time to
 * grow for them. `virtualLineCount` would say so, but it is only recomputed after the
 * view re-wraps, which happens a pass later than the content-change that would resize
 * it. A two-row floor leaves enough room for ordinary wrapping without making an
 * empty prompt look oversized.
 */
export const MIN_EDITOR_ROWS = 2

/** How tall the editor may grow before it scrolls its own content. */
export const MAX_EDITOR_ROWS = 5

/** Keep command discovery compact; longer result sets scroll inside this viewport. */
export const MAX_SLASH_MENU_ROWS = 16

/** Clamp the editor's height to the lines its draft holds, within the budget. */
function editorRows(lines: number): number {
  return Math.min(Math.max(lines, MIN_EDITOR_ROWS), MAX_EDITOR_ROWS)
}

/** A slash token that begins at a prompt token boundary and still owns the cursor. */
export interface SlashToken {
  start: number
  end: number
  filter: string
}

interface SlashCompletion {
  readonly kind: "slash"
  readonly token: SlashToken
  readonly selected: number
}

interface FileCompletion {
  readonly kind: "file"
  readonly token: FileToken
  readonly status: FileSelectorStatus
  readonly paths: readonly string[]
  readonly selected: number
  readonly sessionId: SessionId
  readonly generation: number
  readonly openedAt: number
  readonly revision: number
}

type PromptCompletion = SlashCompletion | FileCompletion | null

interface ActiveFileInteraction {
  readonly sessionId: SessionId
  readonly tokenStart: number
  readonly generation: number
  readonly openedAt: number
}

interface FilePathCache {
  readonly sessionId: SessionId
  readonly paths: readonly string[]
}

interface PendingQueryRenderMetric {
  readonly sessionId: SessionId
  readonly revision: number
  readonly state: "results" | "empty" | "unavailable"
  readonly startedAt: number
}

/**
 * Return the slash token at the cursor, never one embedded in a URL, path, or word.
 * A second slash disarms completion so `/usr/bin` stays ordinary prompt text.
 */
export function slashTokenAt(text: string, cursorOffset: number): SlashToken | null {
  const cursor = Math.max(0, Math.min(cursorOffset, text.length))
  let start = cursor
  while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1
  let end = cursor
  while (end < text.length && !/\s/.test(text[end]!)) end += 1

  const token = text.slice(start, end)
  if (cursor === start || !token.startsWith("/") || token.indexOf("/", 1) !== -1) return null
  return { start, end, filter: token.slice(1) }
}

/**
 * Resolve a complete cockpit command directly from the editor buffer.
 *
 * The menu normally owns Enter. This exact-draft fallback covers the tiny interval
 * where native textarea submission arrives before React has committed the menu state,
 * without claiming agent commands or slash text with arguments. Trailing whitespace
 * is accepted because it dismisses the menu while the developer still intends to run
 * the cockpit command.
 */
export function cockpitCommandForDraft(text: string, cursorOffset: number): CockpitCommand | null {
  if (cursorOffset !== text.length) return null
  const commandEnd = text.trimEnd().length
  const token = slashTokenAt(text.slice(0, commandEnd), commandEnd)
  if (!token || token.start !== 0 || token.end !== commandEnd) return null
  return COCKPIT_COMMANDS.find((command) => command.name === token.filter)?.command ?? null
}

/** Build the deterministic cockpit-first command rows, filtering a slash token. */
export function slashMenuRows(filter: string, agentCommands: readonly AvailableCommand[]): MenuRow[] {
  const normalized = filter.trim().toLocaleLowerCase()
  const matches = (name: string): boolean =>
    normalized.length === 0 || name.toLocaleLowerCase().startsWith(normalized)

  // The menu is a teaching surface: keep the product-defining hand-off visible at
  // the top, then retain the registry's deterministic order for every other action.
  const cockpitCommands = [...COCKPIT_COMMANDS].sort((left, right) =>
    left.command === "hand-off" ? -1 : right.command === "hand-off" ? 1 : 0
  )
  const cockpitRows: MenuRow[] = cockpitCommands
    .filter((command) => matches(command.name))
    .map((command) => ({
      source: "cockpit" as const,
      command: command.command,
      label: `/${command.name}`,
      shortcut: COCKPIT_KEYMAP.find((binding) => binding.command === command.command)?.keys ?? `/${command.name}`,
    }))
  const agentRows: MenuRow[] = agentCommands
    .map((command) => ({ ...command, name: command.name.replace(/^\/+/, "") }))
    .filter((command) => command.name.length > 0 && matches(command.name))
    .map((command) => ({
      source: "agent" as const,
      name: command.name,
      label: `/${command.name}`,
      ...(command.hint ? { hint: command.hint } : {}),
    }))

  return [...cockpitRows, ...agentRows]
}

function menuGroups(rows: readonly MenuRow[]): SlashMenuGroup[] {
  const cockpit = rows.filter((row): row is Extract<MenuRow, { source: "cockpit" }> => row.source === "cockpit")
  const agent = rows.filter((row): row is Extract<MenuRow, { source: "agent" }> => row.source === "agent")
  return [
    ...(cockpit.length > 0 ? [{ source: "Cockpit", rows: cockpit }] : []),
    ...(agent.length > 0 ? [{ source: "Agent commands", rows: agent }] : []),
  ]
}

/**
 * Let OpenTUI perform vertical movement, then report whether its native cursor moved.
 *
 * OpenTUI 0.4.3 declares a boolean result here but its shipped renderable currently
 * returns `true` even when the native editor clamps at a boundary. Comparing the
 * native cursor offset before and after preserves wrapping behavior without teaching
 * the composer how visual lines are calculated.
 */
function moveVertically(editor: TextareaRenderable, direction: "previous" | "next"): boolean {
  const before = editor.visualCursor.offset
  const reported = direction === "previous" ? editor.moveCursorUp() : editor.moveCursorDown()
  return reported && editor.visualCursor.offset !== before
}

/** Identify the first accepted reference removed by the pure range update. */
function correctedReferenceSession(
  previous: readonly PendingFileReference[],
  next: readonly PendingFileReference[],
): SessionId | null {
  const retained = new Map<string, number>()
  for (const reference of next) {
    const key = `${reference.sessionId}\u0000${reference.text}`
    retained.set(key, (retained.get(key) ?? 0) + 1)
  }
  for (const reference of previous) {
    const key = `${reference.sessionId}\u0000${reference.text}`
    const count = retained.get(key) ?? 0
    if (count === 0) return reference.sessionId
    retained.set(key, count - 1)
  }
  return null
}

/** The multi-line prompt editor, bound to whichever agent currently has focus. */
export function PromptEditor({ onRunCommand = NOOP_RUN_COMMAND }: { onRunCommand?: (command: CockpitCommand) => void }): ReactNode {
  const selectedSessionId = useAppSelector(selectFocusedSessionId)
  return selectedSessionId === null
    ? <WorkspacePromptEditor />
    : <SelectedPromptEditor sessionId={selectedSessionId} onRunCommand={onRunCommand} />
}

/** A non-editable composer surface for the valid no-selection workspace state. */
function WorkspacePromptEditor(): ReactNode {
  const palette = usePalette()
  return (
    <box
      borderStyle="rounded"
      style={{
        position: "relative",
        flexShrink: 0,
        flexDirection: "row",
        gap: 1,
        border: true,
        borderColor: palette.status.not_ready,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={PROMPT_WORKSPACE_TITLE}
      titleColor={palette.status.not_ready}
    >
      <text fg={palette.status.not_ready}>{PROMPT_CHEVRON}</text>
      <text style={{ height: MIN_EDITOR_ROWS, flexGrow: 1 }} fg={palette.muted}>
        {PROMPT_WORKSPACE_PLACEHOLDER}
      </text>
    </box>
  )
}

/** The editable composer for one real selected Visible conversation. */
function SelectedPromptEditor({
  sessionId: focusedSessionId,
  onRunCommand,
}: {
  sessionId: SessionId
  onRunCommand: (command: CockpitCommand) => void
}): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height: terminalHeight } = useTerminalDimensions()

  // Curried selectors build a new function per call; memoize so the subscription
  // follows focus rather than tearing down and rebuilding on every render.
  const statusSelector = useMemo(() => selectSessionStatus(focusedSessionId), [focusedSessionId])
  const status = useAppSelector(statusSelector)
  const commandsSelector = useMemo(() => selectSessionCommands(focusedSessionId), [focusedSessionId])
  const agentCommands = useAppSelector(commandsSelector)
  const historySelector = useMemo(() => selectSessionPromptHistory(focusedSessionId), [focusedSessionId])
  const promptHistory = useAppSelector(historySelector)
  const continuationStatusSelector = useMemo(
    () => selectSessionPostInterruptContinuationStatus(focusedSessionId),
    [focusedSessionId],
  )
  const continuationStatus = useAppSelector(continuationStatusSelector)
  const continuationRecoverySelector = useMemo(
    () => selectSessionPostInterruptContinuationRecovery(focusedSessionId),
    [focusedSessionId],
  )
  const continuationRecovery = useAppSelector(continuationRecoverySelector)
  const steeringStatusSelector = useMemo(
    () => selectSessionSteeringStatus(focusedSessionId),
    [focusedSessionId],
  )
  const steeringStatus = useAppSelector(steeringStatusSelector)
  const steeringRecoverySelector = useMemo(
    () => selectSessionSteeringRecovery(focusedSessionId),
    [focusedSessionId],
  )
  const steeringRecovery = useAppSelector(steeringRecoverySelector)
  const activeTurn = status === "working"
    || status === "awaiting_approval"
    || status === "awaiting_clarification"

  // Readiness is a boot-time fact about the connection, not a store slice: a session
  // whose handshake failed has no ACP session, so nothing may be sent to it.
  const ready = controller.isReady(focusedSessionId)
  const overlayOpen = useAppSelector(selectHasOpenOverlay)
  const isShellFocused = useAppSelector(selectIsShellFocused)
  const restorationSelector = useMemo(() => selectRestoration(focusedSessionId), [focusedSessionId])
  const restoration = useAppSelector(restorationSelector)
  const restorationBundle = useAppSelector(selectRestorationBundle)
  // A persisted bundle is still the only visible conversation context until `/new`
  // recreates the unavailable pane. Let the editor keep handling that command, but
  // never let an ordinary prompt create turns hidden behind the context pane.
  const restorationContextOpen = restoration === "unavailable" && restorationBundle !== null

  const textarea = useRef<TextareaRenderable | null>(null)
  const previousSession = useRef(focusedSessionId)
  const recalledSession = useRef<SessionId | null>(null)
  const focusedSession = useRef(focusedSessionId)
  focusedSession.current = focusedSessionId
  const [rows, setRows] = useState(MIN_EDITOR_ROWS)
  const [recoveryNotice, setRecoveryNotice] = useState<"restored" | "waiting" | null>(null)
  const [continuationNotice, setContinuationNotice] = useState<
    "restored" | "waiting" | "fallback" | null
  >(null)
  const [completion, setCompletion] = useState<PromptCompletion>(null)
  const completionRef = useRef<PromptCompletion>(null)
  const fileCache = useRef<FilePathCache | null>(null)
  const fileLoad = useRef<{ sessionId: SessionId; generation: number } | null>(null)
  const fileRequestGeneration = useRef(0)
  const fileRevision = useRef(0)
  const activeFileInteraction = useRef<ActiveFileInteraction | null>(null)
  const fileSuppression = useRef<FileTokenSuppression | null>(null)
  const pendingFileReferences = useRef<readonly PendingFileReference[]>([])
  const previousDraft = useRef("")
  const acceptingFileReference = useRef(false)
  const continuationAdmissionOpen = useRef(false)
  const applyingContinuationRecovery = useRef(false)
  const applyingSteeringRecovery = useRef(false)
  const pendingQueryRenderMetric = useRef<PendingQueryRenderMetric | null>(null)

  const commitCompletion = useCallback((next: PromptCompletion): void => {
    completionRef.current = next
    setCompletion(next)
  }, [])

  const slashCompletion = completion?.kind === "slash" ? completion : null
  const matchingRows = useMemo(
    () => slashMenuRows(slashCompletion?.token.filter ?? "", agentCommands),
    [agentCommands, slashCompletion?.token.filter],
  )
  const armedSlashMenu = slashCompletion !== null && matchingRows.length > 0 ? slashCompletion : null
  const slashHighlight = Math.min(armedSlashMenu?.selected ?? 0, Math.max(matchingRows.length - 1, 0))
  const fileCompletion = completion?.kind === "file" ? completion : null
  const armedFileMenu = fileCompletion?.status === "ready" && fileCompletion.paths.length > 0
    ? fileCompletion
    : null
  const fileHighlight = Math.min(armedFileMenu?.selected ?? 0, Math.max((armedFileMenu?.paths.length ?? 0) - 1, 0))

  const syncRows = useCallback((editor = textarea.current): void => {
    if (!editor) return
    const next = editorRows(Math.max(editor.lineCount, editor.editorView.getTotalVirtualLineCount()))
    setRows((current) => (current === next ? current : next))
  }, [])

  const restoreSteeringRecovery = useCallback((): boolean => {
    const editor = textarea.current
    if (!editor || !steeringRecovery) return false
    if (editor.plainText.length > 0) {
      setRecoveryNotice("waiting")
      return false
    }

    const recoveredText = steeringRecovery.blocks.map((block) => block.text).join("\n")
    applyingSteeringRecovery.current = true
    acceptingFileReference.current = true
    editor.setText(recoveredText)
    previousDraft.current = recoveredText
    acceptingFileReference.current = false
    recalledSession.current = null
    pendingFileReferences.current = []
    activeFileInteraction.current = null
    fileSuppression.current = null
    pendingQueryRenderMetric.current = null
    commitCompletion(null)
    syncRows(editor)
    controller.actions.acknowledgeSteeringRecovery(focusedSessionId, steeringRecovery.requestId)
    setRecoveryNotice("restored")
    return true
  }, [commitCompletion, controller, focusedSessionId, steeringRecovery, syncRows])

  const restoreContinuationRecovery = useCallback((): boolean => {
    const editor = textarea.current
    if (!editor || !continuationRecovery) return false
    if (editor.plainText.length > 0) {
      setContinuationNotice("waiting")
      return false
    }

    const recoveredText = continuationRecovery.blocks.map((block) => block.text).join("\n")
    applyingContinuationRecovery.current = true
    acceptingFileReference.current = true
    editor.setText(recoveredText)
    previousDraft.current = recoveredText
    acceptingFileReference.current = false
    recalledSession.current = null
    pendingFileReferences.current = []
    activeFileInteraction.current = null
    fileSuppression.current = null
    pendingQueryRenderMetric.current = null
    continuationAdmissionOpen.current = false
    commitCompletion(null)
    syncRows(editor)
    controller.actions.acknowledgePostInterruptRecovery(
      focusedSessionId,
      continuationRecovery.requestId,
    )
    setContinuationNotice("restored")
    return true
  }, [commitCompletion, continuationRecovery, controller, focusedSessionId, syncRows])

  const renderCachedFileToken = useCallback((
    token: FileToken,
    interaction: ActiveFileInteraction,
    paths: readonly string[],
    measureWarmQuery: boolean,
  ): void => {
    const visiblePaths = visibleFileMatches(rankFileMatches(paths, token.filter))
    const status: FileSelectorStatus = visiblePaths.length > 0 ? "ready" : "empty"
    const revision = ++fileRevision.current
    if (measureWarmQuery) {
      pendingQueryRenderMetric.current = {
        sessionId: interaction.sessionId,
        revision,
        state: status === "ready" ? "results" : "empty",
        startedAt: performance.now(),
      }
    }
    commitCompletion({
      kind: "file",
      token,
      status,
      paths: visiblePaths,
      selected: 0,
      sessionId: interaction.sessionId,
      generation: interaction.generation,
      openedAt: interaction.openedAt,
      revision,
    })
  }, [commitCompletion])

  const beginFileCompletion = useCallback((token: FileToken): void => {
    const current = completionRef.current
    const active = activeFileInteraction.current
    if (active?.sessionId === focusedSessionId && active.tokenStart === token.start) {
      if (current?.kind === "file" && current.status === "loading") {
        commitCompletion({ ...current, token, selected: 0 })
        return
      }
      if (
        current?.kind === "file"
        && (current.status === "ready" || current.status === "empty")
        && fileCache.current?.sessionId === focusedSessionId
      ) {
        renderCachedFileToken(token, active, fileCache.current.paths, true)
        return
      }
      if (current?.kind === "file" && current.status === "unavailable") {
        const revision = ++fileRevision.current
        pendingQueryRenderMetric.current = {
          sessionId: focusedSessionId,
          revision,
          state: "unavailable",
          startedAt: performance.now(),
        }
        commitCompletion({ ...current, token, selected: 0, revision })
        return
      }
    }

    const openedAt = performance.now()
    controller.actions.fileSelectorOpened(focusedSessionId)
    const cached = fileCache.current
    if (cached?.sessionId === focusedSessionId) {
      const interaction: ActiveFileInteraction = {
        sessionId: focusedSessionId,
        tokenStart: token.start,
        generation: fileRequestGeneration.current,
        openedAt,
      }
      activeFileInteraction.current = interaction
      renderCachedFileToken(token, interaction, cached.paths, true)
      return
    }

    const inFlight = fileLoad.current
    if (inFlight?.sessionId === focusedSessionId) {
      const interaction: ActiveFileInteraction = {
        sessionId: focusedSessionId,
        tokenStart: token.start,
        generation: inFlight.generation,
        openedAt,
      }
      activeFileInteraction.current = interaction
      commitCompletion({
        kind: "file",
        token,
        status: "loading",
        paths: [],
        selected: 0,
        sessionId: focusedSessionId,
        generation: inFlight.generation,
        openedAt,
        revision: ++fileRevision.current,
      })
      return
    }

    const generation = ++fileRequestGeneration.current
    const interaction: ActiveFileInteraction = {
      sessionId: focusedSessionId,
      tokenStart: token.start,
      generation,
      openedAt,
    }
    activeFileInteraction.current = interaction
    fileLoad.current = { sessionId: focusedSessionId, generation }
    commitCompletion({
      kind: "file",
      token,
      status: "loading",
      paths: [],
      selected: 0,
      sessionId: focusedSessionId,
      generation,
      openedAt,
      revision: ++fileRevision.current,
    })

    const discoveryStartedAt = performance.now()
    void controller.actions.listRepositoryFiles(focusedSessionId).then(
      (result) => {
        controller.actions.fileSelectorDiscovery(
          focusedSessionId,
          result.kind,
          Math.max(0, performance.now() - discoveryStartedAt),
        )
        if (
          focusedSession.current !== focusedSessionId
          || fileRequestGeneration.current !== generation
          || fileLoad.current?.generation !== generation
        ) return

        fileLoad.current = null
        if (result.kind === "ready") fileCache.current = { sessionId: focusedSessionId, paths: result.paths }

        const editor = textarea.current
        const currentInteraction = activeFileInteraction.current
        const currentToken = editor ? fileTokenAt(editor.plainText, editor.cursorOffset) : null
        if (
          !currentInteraction
          || currentInteraction.sessionId !== focusedSessionId
          || currentInteraction.generation !== generation
          || currentToken?.start !== currentInteraction.tokenStart
          || isFileTokenSuppressed(fileSuppression.current, currentToken)
        ) return

        if (result.kind === "ready") {
          renderCachedFileToken(currentToken, currentInteraction, result.paths, false)
          return
        }
        commitCompletion({
          kind: "file",
          token: currentToken,
          status: "unavailable",
          paths: [],
          selected: 0,
          sessionId: focusedSessionId,
          generation,
          openedAt: currentInteraction.openedAt,
          revision: ++fileRevision.current,
        })
      },
      () => {
        controller.actions.fileSelectorDiscovery(
          focusedSessionId,
          "unavailable",
          Math.max(0, performance.now() - discoveryStartedAt),
        )
        if (
          focusedSession.current !== focusedSessionId
          || fileRequestGeneration.current !== generation
          || fileLoad.current?.generation !== generation
        ) return
        fileLoad.current = null

        const editor = textarea.current
        const currentInteraction = activeFileInteraction.current
        const currentToken = editor ? fileTokenAt(editor.plainText, editor.cursorOffset) : null
        if (
          !currentInteraction
          || currentInteraction.generation !== generation
          || currentToken?.start !== currentInteraction.tokenStart
          || isFileTokenSuppressed(fileSuppression.current, currentToken)
        ) return
        commitCompletion({
          kind: "file",
          token: currentToken,
          status: "unavailable",
          paths: [],
          selected: 0,
          sessionId: focusedSessionId,
          generation,
          openedAt: currentInteraction.openedAt,
          revision: ++fileRevision.current,
        })
      },
    )
  }, [commitCompletion, controller, focusedSessionId, renderCachedFileToken])

  useEffect(() => {
    const metric = pendingQueryRenderMetric.current
    if (
      !metric
      || !fileCompletion
      || fileCompletion.sessionId !== metric.sessionId
      || fileCompletion.revision !== metric.revision
    ) return
    pendingQueryRenderMetric.current = null
    controller.actions.fileSelectorQueryRendered(
      metric.sessionId,
      metric.state,
      Math.max(0, performance.now() - metric.startedAt),
    )
  }, [controller, fileCompletion])

  // The textarea is deliberately shared across ordinary focus changes so an unsent
  // draft survives. Recalled text is different: it belongs to one session. Clear it
  // when entering an ordinary session, or restore the target session's own selected
  // history entry when returning to a session that is still browsing.
  useEffect(() => {
    if (previousSession.current === focusedSessionId) return
    previousSession.current = focusedSessionId
    setRecoveryNotice(null)
    setContinuationNotice(null)
    continuationAdmissionOpen.current = false
    fileRequestGeneration.current += 1
    fileCache.current = null
    fileLoad.current = null
    fileSuppression.current = null
    activeFileInteraction.current = null
    pendingQueryRenderMetric.current = null
    commitCompletion(null)

    const editor = textarea.current
    if (!editor) return
    const recalled = promptHistory.cursor === null ? undefined : promptHistory.entries[promptHistory.cursor]
    if (recalled !== undefined) {
      editor.setText(recalled)
      previousDraft.current = recalled
      recalledSession.current = focusedSessionId
      syncRows(editor)
      return
    }
    if (recalledSession.current !== null) {
      editor.clear()
      previousDraft.current = ""
      recalledSession.current = null
      syncRows(editor)
    }
  }, [commitCompletion, focusedSessionId, promptHistory, syncRows])

  // Recovery is an external-store payload that must be copied into OpenTUI's native
  // edit buffer exactly once before the controller is allowed to acknowledge it.
  useEffect(() => {
    if (continuationRecovery) {
      restoreContinuationRecovery()
      return
    }
    if (steeringRecovery) restoreSteeringRecovery()
  }, [continuationRecovery, restoreContinuationRecovery, restoreSteeringRecovery, steeringRecovery])

  useEffect(() => () => {
    fileRequestGeneration.current += 1
  }, [])

  const submit = useCallback((): void => {
    const editor = textarea.current
    if (!editor) return

    const text = editor.plainText
    const cockpitCommand = cockpitCommandForDraft(text, editor.cursorOffset)
    if (cockpitCommand !== null) {
      acceptingFileReference.current = true
      editor.clear()
      previousDraft.current = ""
      acceptingFileReference.current = false
      activeFileInteraction.current = null
      fileSuppression.current = null
      pendingQueryRenderMetric.current = null
      commitCompletion(null)
      setRows(MIN_EDITOR_ROWS)
      onRunCommand(cockpitCommand)
      return
    }
    if (!ready || restorationContextOpen) return

    // A stray Enter on an empty or whitespace-only buffer must not start a turn.
    if (text.trim().length === 0) return

    // A pending recovery owns its exact payload until the editor can copy it. Never
    // clear or dispatch a changed draft while that lossless hand-off is unresolved.
    if (continuationRecovery !== null) {
      setContinuationNotice("waiting")
      return
    }
    if (steeringRecovery !== null) {
      setRecoveryNotice("waiting")
      return
    }

    if (continuationStatus.queueCount > 0) return

    let acceptedContinuation = false
    if (
      continuationAdmissionOpen.current &&
      continuationStatus.phase === "idle"
    ) {
      const result = controller.actions.queuePostInterruptContinuation(text)
      continuationAdmissionOpen.current = false
      if (result.kind !== "queued") {
        setContinuationNotice("fallback")
        return
      }
      acceptedContinuation = true
      setContinuationNotice(null)
    } else if (activeTurn) {
      const result = controller.actions.steer(text)
      if (result.kind !== "queued") return
    }

    // Local acceptance owns history even if the asynchronous agent call later fails.
    controller.actions.recordPromptHistory(text, focusedSessionId)
    recalledSession.current = null
    pendingFileReferences.current = clearPendingFileReferencesOnSubmit(pendingFileReferences.current).pending
    activeFileInteraction.current = null
    fileSuppression.current = null
    pendingQueryRenderMetric.current = null
    commitCompletion(null)

    // Clear only after local acceptance. Active steering is accepted synchronously;
    // ordinary sending keeps the existing transcript-first asynchronous path.
    acceptingFileReference.current = true
    editor.clear()
    previousDraft.current = ""
    acceptingFileReference.current = false
    setRows(MIN_EDITOR_ROWS)
    if (!activeTurn && !acceptedContinuation) void controller.actions.sendPrompt(text)
  }, [
    activeTurn,
    commitCompletion,
    continuationRecovery,
    continuationStatus.phase,
    continuationStatus.queueCount,
    controller,
    focusedSessionId,
    onRunCommand,
    ready,
    restorationContextOpen,
    steeringRecovery,
  ])

  const selectSlashMenuRow = useCallback((selectedRow?: MenuRow): void => {
    const editor = textarea.current
    if (!editor || !armedSlashMenu) return
    const row = selectedRow ?? matchingRows[slashHighlight]
    if (!row) return

    if (row.source === "cockpit") {
      editor.setSelection(armedSlashMenu.token.start, armedSlashMenu.token.end)
      editor.deleteSelection()
      commitCompletion(null)
      syncRows(editor)
      onRunCommand(row.command)
      return
    }

    editor.setSelection(armedSlashMenu.token.start, armedSlashMenu.token.end)
    editor.insertText(`/${row.name} `)
    commitCompletion(null)
    syncRows(editor)
  }, [armedSlashMenu, commitCompletion, matchingRows, onRunCommand, slashHighlight, syncRows])

  const selectFileMenuRow = useCallback((): void => {
    const editor = textarea.current
    if (!editor || !armedFileMenu) return
    const path = armedFileMenu.paths[fileHighlight]
    if (!path) return

    const reference = formatFileReference(path)
    acceptingFileReference.current = true
    editor.setSelection(armedFileMenu.token.start, armedFileMenu.token.end)
    editor.insertText(`${reference} `)
    const nextDraft = editor.plainText
    previousDraft.current = nextDraft
    acceptingFileReference.current = false
    pendingFileReferences.current = [
      ...pendingFileReferences.current,
      {
        text: reference,
        start: armedFileMenu.token.start,
        end: armedFileMenu.token.start + reference.length,
        sessionId: armedFileMenu.sessionId,
      },
    ]
    controller.actions.fileSelectorSelected(
      armedFileMenu.sessionId,
      Math.max(0, performance.now() - armedFileMenu.openedAt),
    )
    activeFileInteraction.current = null
    fileSuppression.current = null
    pendingQueryRenderMetric.current = null
    commitCompletion(null)
    syncRows(editor)
  }, [armedFileMenu, commitCompletion, controller, fileHighlight, syncRows])

  const moveCompletionSelection = useCallback((direction: "previous" | "next", lastIndex: number): void => {
    const current = completionRef.current
    if (!current) return
    const selected = direction === "previous"
      ? Math.max(current.selected - 1, 0)
      : Math.min(current.selected + 1, Math.max(lastIndex, 0))
    commitCompletion({ ...current, selected })
  }, [commitCompletion])

  const onKeyDown = useCallback(
    (key: KeyEvent): void => {
      const command = matchMenuCommand(key)
      if (fileCompletion && command === "dismiss") {
        key.preventDefault()
        fileSuppression.current = suppressFileToken(fileCompletion.token)
        activeFileInteraction.current = null
        pendingQueryRenderMetric.current = null
        commitCompletion(null)
        return
      }
      if (armedFileMenu && command !== null) {
        key.preventDefault()
        switch (command) {
          case "prev-item":
            moveCompletionSelection("previous", armedFileMenu.paths.length - 1)
            return
          case "next-item":
            moveCompletionSelection("next", armedFileMenu.paths.length - 1)
            return
          case "confirm":
            selectFileMenuRow()
            return
          case "dismiss":
            return
        }
      }
      if (armedSlashMenu) {
        if (command !== null) {
          key.preventDefault()
          switch (command) {
            case "prev-item":
              moveCompletionSelection("previous", matchingRows.length - 1)
              return
            case "next-item":
              moveCompletionSelection("next", matchingRows.length - 1)
              return
            case "confirm":
              selectSlashMenuRow()
              return
            case "dismiss":
              commitCompletion(null)
              return
          }
        }
      }
      const verticalDirection = key.name === "up" ? "previous" : key.name === "down" ? "next" : null
      const modified = key.ctrl || key.meta || key.shift || key.option || key.super || key.hyper
      if (verticalDirection !== null && !modified) {
        const editor = textarea.current
        if (!editor) return
        key.preventDefault()
        if (moveVertically(editor, verticalDirection)) return

        const selection = controller.actions.navigatePromptHistory(verticalDirection, focusedSessionId)
        if (selection.text === null) return
        editor.setText(selection.text)
        recalledSession.current = selection.text === "" ? null : focusedSessionId
        syncRows(editor)
        return
      }
      if (key.name !== "escape" || key.ctrl || key.meta || key.shift) return
      if (
        continuationStatus.queueCount > 0 &&
        continuationStatus.phase !== "recovery"
      ) {
        key.preventDefault()
        continuationAdmissionOpen.current = false
        controller.actions.recoverPostInterruptContinuation()
        return
      }
      // Escape only means "interrupt" when there is a turn to interrupt. Idle, it
      // stays free for whatever the shell or a future overlay wants to do with it.
      if (status !== "working") return
      key.preventDefault()
      continuationAdmissionOpen.current = true
      setContinuationNotice(null)
      void controller.actions.cancel()
    },
    [
      armedFileMenu,
      armedSlashMenu,
      commitCompletion,
      continuationStatus.phase,
      continuationStatus.queueCount,
      controller,
      fileCompletion,
      focusedSessionId,
      matchingRows.length,
      moveCompletionSelection,
      selectFileMenuRow,
      selectSlashMenuRow,
      status,
      syncRows,
    ],
  )

  // Keep visual and input height in sync after both content and layout changes. A
  // long word can occupy several virtual rows even though it is only one logical line.
  const onContentChange = useCallback((): void => {
    const editor = textarea.current
    if (!editor) return
    const text = editor.plainText

    if (applyingContinuationRecovery.current) {
      applyingContinuationRecovery.current = false
      previousDraft.current = text
      syncRows(editor)
      return
    }

    if (applyingSteeringRecovery.current) {
      applyingSteeringRecovery.current = false
      previousDraft.current = text
      syncRows(editor)
      return
    }

    if (acceptingFileReference.current) {
      previousDraft.current = text
      syncRows(editor)
      return
    }

    if (continuationRecovery !== null) {
      if (text.length === 0 && restoreContinuationRecovery()) return
      setContinuationNotice("waiting")
    } else if (continuationNotice === "restored") {
      setContinuationNotice(null)
    }

    if (steeringRecovery !== null) {
      if (text.length === 0 && restoreSteeringRecovery()) return
      setRecoveryNotice("waiting")
    } else if (recoveryNotice === "restored") {
      setRecoveryNotice(null)
    }

    const priorPending = pendingFileReferences.current
    const pendingUpdate = updatePendingFileReferences(previousDraft.current, text, priorPending)
    if (pendingUpdate.corrected) {
      const correctedSession = correctedReferenceSession(priorPending, pendingUpdate.pending)
      if (correctedSession !== null) controller.actions.fileSelectorCorrected(correctedSession)
    }
    pendingFileReferences.current = pendingUpdate.pending
    previousDraft.current = text

    if (text === "!" && editor.cursorOffset === 1) {
      acceptingFileReference.current = true
      editor.clear()
      previousDraft.current = ""
      acceptingFileReference.current = false
      activeFileInteraction.current = null
      fileSuppression.current = null
      pendingQueryRenderMetric.current = null
      commitCompletion(null)
      syncRows(editor)
      onRunCommand("toggle-shell")
      return
    }

    syncRows(editor)
    const fileToken = fileTokenAt(text, editor.cursorOffset)
    fileSuppression.current = updateFileTokenSuppression(fileSuppression.current, fileToken)
    if (fileToken !== null && !isFileTokenSuppressed(fileSuppression.current, fileToken)) {
      beginFileCompletion(fileToken)
      return
    }
    if (completionRef.current?.kind === "file") {
      activeFileInteraction.current = null
      pendingQueryRenderMetric.current = null
      commitCompletion(null)
    }

    const slashToken = slashTokenAt(text, editor.cursorOffset)
    if (slashToken === null || slashMenuRows(slashToken.filter, agentCommands).length === 0) {
      commitCompletion(null)
      return
    }
    commitCompletion({ kind: "slash", token: slashToken, selected: 0 })
  }, [
    agentCommands,
    beginFileCompletion,
    commitCompletion,
    continuationNotice,
    continuationRecovery,
    controller,
    onRunCommand,
    recoveryNotice,
    restoreContinuationRecovery,
    restoreSteeringRecovery,
    steeringRecovery,
    syncRows,
  ])

  const onCursorChange = useCallback((): void => {
    const editor = textarea.current
    if (!editor) return
    const token = fileTokenAt(editor.plainText, editor.cursorOffset)
    fileSuppression.current = updateFileTokenSuppression(fileSuppression.current, token)
    const current = completionRef.current
    if (
      current?.kind === "file"
      && (
        token === null
        || token.start !== current.token.start
        || isFileTokenSuppressed(fileSuppression.current, token)
      )
    ) {
      activeFileInteraction.current = null
      pendingQueryRenderMetric.current = null
      commitCompletion(null)
    }
  }, [commitCompletion])

  const onSizeChange = useCallback(
    function onSizeChange(this: EditBufferRenderable): void {
      const next = editorRows(Math.max(this.lineCount, this.editorView.getTotalVirtualLineCount()))
      setRows((current) => (current === next ? current : next))
    },
    [syncRows],
  )

  const steeringTitle = recoveryNotice === "restored"
    ? "Steering failed · draft restored"
    : recoveryNotice === "waiting"
      ? "Steering failed · recovery waiting; clear editor to restore"
      : steeringStatus.phase === "failed"
        ? "Steering failed · recovery ready"
        : steeringStatus.phase === "sending"
          ? `Steering sending (${steeringStatus.queueCount})`
          : steeringStatus.phase === "waiting"
            ? `Steering queued (${steeringStatus.queueCount}) · waiting for interaction`
            : steeringStatus.phase === "cancelling" || steeringStatus.phase === "settling"
              ? `Steering queued (${steeringStatus.queueCount}) · redirecting`
              : steeringStatus.phase === "queued"
                ? `Steering queued (${steeringStatus.queueCount})`
                : null
  const continuationTitle = continuationNotice === "restored"
    ? "Continuation not sent · draft restored; use /new"
    : continuationNotice === "waiting"
      ? "Continuation not sent · clear editor to restore; use /new"
      : continuationNotice === "fallback"
        ? "Continuation unavailable · draft retained; use /new"
        : continuationStatus.phase === "recovery"
          ? "Continuation not sent · recovery ready; use /new"
          : continuationStatus.phase === "dispatching"
            ? "Continuation dispatching as the next prompt"
            : continuationStatus.phase === "waiting"
              ? "Continuation waiting for the interrupted turn to settle"
              : continuationStatus.phase === "queued"
                ? "Continuation queued · waiting to continue safely"
                : null
  const historyTitle = ready && promptHistory.cursor !== null
    ? `${PROMPT_HISTORY_TITLE} ${promptHistory.cursor + 1}/${promptHistory.entries.length}`
    : null
  const composerTitle = [historyTitle, continuationTitle ?? steeringTitle].filter(Boolean).join(" · ") || undefined

  return (
    <box
      borderStyle="rounded"
      style={{
        position: "relative",
        flexShrink: 0,
        flexDirection: "row",
        gap: 1,
        border: true,
        borderColor: ready ? palette.border : palette.status.not_ready,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        overflow: "visible",
      }}
      title={composerTitle}
      titleColor={
        continuationTitle?.startsWith("Continuation not sent") ||
        continuationTitle?.startsWith("Continuation unavailable") ||
        steeringTitle?.startsWith("Steering failed")
          ? palette.status.error
          : palette.accent
      }
    >
      {armedSlashMenu ? (
        <box style={{ position: "absolute", left: 0, right: 0, bottom: rows + 2, zIndex: 1 }}>
          <SlashMenu
            groups={menuGroups(matchingRows)}
            highlightedIndex={slashHighlight}
            maxHeight={Math.max(1, Math.min(MAX_SLASH_MENU_ROWS, terminalHeight - rows - 5))}
            onSelect={selectSlashMenuRow}
          />
        </box>
      ) : fileCompletion ? (
        <box
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: rows + 2,
            zIndex: 1,
            height: fileCompletion.status === "ready" ? fileCompletion.paths.length + 2 : 1,
          }}
        >
          <FileSelector
            key={`${fileCompletion.sessionId}:${fileCompletion.revision}`}
            status={fileCompletion.status}
            paths={fileCompletion.paths}
            highlightedIndex={fileHighlight}
          />
        </box>
      ) : null}
      <text fg={ready ? palette.accent : palette.status.not_ready}>{PROMPT_CHEVRON}</text>
      <textarea
        ref={textarea}
        focused={!overlayOpen && !isShellFocused}
        style={{
          flexGrow: 1,
          height: rows,
          wrapMode: "word",
          textColor: palette.text,
          cursorColor: palette.accent,
          placeholderColor: palette.muted,
        }}
        placeholder={ready ? (activeTurn ? PROMPT_STEERING_PLACEHOLDER : PROMPT_PLACEHOLDER) : PROMPT_DISABLED_PLACEHOLDER}
        keyBindings={PROMPT_KEY_BINDINGS}
        onSubmit={submit}
        onKeyDown={onKeyDown}
        onContentChange={onContentChange}
        onCursorChange={onCursorChange}
        onSizeChange={onSizeChange}
      />
    </box>
  )
}
