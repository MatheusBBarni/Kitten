/**
 * The hand-off preview: the emotional core of the product, and its last safety gate.
 *
 * When the developer presses the hand-off key, `HandoffFlow.begin` assembles the
 * focused agent's session into a redacted bundle and parks it in the store. This
 * overlay is what that slot looks like. It answers the three questions the PRD says
 * the preview must answer, in that order: **what was stripped** (the redaction
 * count), **what is being carried** (the summary, the referenced files, the pending
 * diffs), and **what the developer can change** (all of it - trim the summary, drop
 * a file, drop a dead-end diff).
 *
 * Nothing is sent until Enter. The redactor is deliberately biased to false negatives
 * (ADR-002), so this screen - a human reading the bundle before it leaves - is the
 * control that stops a missed credential from reaching the second agent. There is no
 * path from the keystroke to `sendPrompt` that does not pass through here.
 *
 * Two details make it work as a modal:
 *
 * - **It swallows every key** while the developer is curating, so the composer beneath
 *   never sees them. As with the approval overlay, that takes two halves: the shell
 *   stands its own chords down while an overlay is open (`selectHasOpenOverlay`),
 *   because global key listeners fire in mount order and the shell mounts first, and
 *   `preventDefault` here stops the focused textarea.
 * - **Except while the summary is being edited**, when every key is text. The overlay
 *   then keeps only Escape - the way back out - and lets the rest through to its own
 *   textarea, which has taken the terminal's focus from the composer.
 *
 * The approval overlay outranks it. A permission request blocks an agent mid-turn, so
 * if one arrives while the preview is up, the preview stands down exactly as the shell
 * does for it.
 *
 * It renders as a conditional, absolutely-positioned box: the React binding ships no
 * Portal (ADR-004).
 */

import type { KeyEvent, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { Fragment, useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import type { HandoffFlow } from "../app/handoff.ts"
import { deduplicateHandoffBundle } from "../core/bundleAssembler.ts"
import type { ConfigOption, PendingDiff, ShellCommandRecord } from "../core/types.ts"
import type { HandoffPreviewOverlay } from "../store/appStore.ts"
import { selectHandoffPreview, selectIsApprovalOpen, selectIsClarificationOpen, selectSessionHeadroom } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { formatHeadroom } from "./headroom.ts"
import { CURRENT_MARK, ModelEffortControl, modelEffortValueRows, TARGET_MARK, type ModelEffortValueRow } from "./ModelSelect.tsx"
import { Markdown } from "./Markdown.tsx"
import { HANDOFF_CONFIG_HINT, HANDOFF_EDIT_HINT, HANDOFF_HINT, matchHandoffCommand, matchModelSelectCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"
import { ToolCallDiffView } from "./ToolCallRow.tsx"

/** How the overlay titles itself. The direction is the whole story, so it leads. */
export function handoffTitleFor(sourceName: string, targetName: string): string {
  return `Hand off - ${sourceName} → ${targetName}`
}

/** What the developer is told about the secrets the redactor found. Never silent. */
export function redactionNotice(count: number): string {
  if (count === 0) return "No secrets detected in this bundle."
  return `${count} secret${count === 1 ? "" : "s"} redacted from this bundle.`
}

/** Section headings, in the order the developer reads them. */
export const SUMMARY_HEADING = "Summary"
export const TARGET_HEADROOM_LABEL = "Target headroom"
export const TARGET_CONFIG_HEADING = "Target model & reasoning effort"
export const CONTEXT_PACK_HEADING = "Context Pack attachment"
export const CONTEXT_PACK_LABEL = "Sealed Context Pack"
export const FILES_HEADING = "Referenced files"
export const DIFFS_HEADING = "Pending diffs"
export const SHELL_HEADING = "Shell context"

/** Shown when the target advertises no model or effort choice to carry with the hand-off. */
export const NO_TARGET_CONFIG_OPTIONS = "Target agent advertises no model or reasoning-effort options."

/** Shown in place of a section that the source session gave nothing for. */
export const NO_FILES = "None"

/** The marker on the highlighted row. Matches the approval overlay and the status strip. */
export const ITEM_MARKER = "▸"

/** How a kept row and a dropped row are told apart at a glance. */
export const KEPT_BOX = "[x]"
export const DROPPED_BOX = "[ ]"

/** The OSC 8 target for a referenced file, or plain-text fallback metadata. */
export function fileProvenanceTarget(path: string, hyperlinks: boolean): string | undefined {
  return hyperlinks ? `file://${path}` : undefined
}

/** How tall the summary editor is before it scrolls its own content. */
const SUMMARY_ROWS = 6

/** The summary editor's floor when a short terminal squeezes the dialog. */
const MIN_SUMMARY_ROWS = 2

/** The overlay, or nothing at all. The cockpit mounts it unconditionally. */
export function HandoffPreview({ flow }: { flow: HandoffFlow }): ReactNode {
  const overlay = useAppSelector(selectHandoffPreview)
  if (!overlay) return null
  return <HandoffDialog overlay={overlay} flow={flow} />
}

/** The dialog proper. Mounted only while a bundle is waiting to be curated. */
function HandoffDialog({ overlay, flow }: { overlay: HandoffPreviewOverlay; flow: HandoffFlow }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const renderer = useRenderer()
  const { height } = useTerminalDimensions()
  const clarificationOpen = useAppSelector(selectIsClarificationOpen)
  const approvalOpen = useAppSelector(selectIsApprovalOpen)

  const { bundle, sourceSessionId, targetSessionId, targetConfigOptions } = overlay
  const targetHeadroomSelector = useMemo(() => selectSessionHeadroom(targetSessionId), [targetSessionId])
  const selectedTargetHeadroom = useAppSelector(targetHeadroomSelector)
  const targetHeadroom = formatHeadroom(selectedTargetHeadroom)
  const shellCommands = bundle.shell?.commands ?? []

  const [selected, setSelected] = useState(0)
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(() => new Set())
  const [excludedDiffs, setExcludedDiffs] = useState<ReadonlySet<string>>(() => new Set())
  const [excludedCommands, setExcludedCommands] = useState<ReadonlySet<string>>(() => new Set())
  const [excludeContextPack, setExcludeContextPack] = useState(false)
  const [editing, setEditing] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState(bundle.summary)
  const [editingTargetConfig, setEditingTargetConfig] = useState(false)
  const [targetSelected, setTargetSelected] = useState(0)
  const targetSelectedRef = useRef(0)
  const [targetConfig, setTargetConfig] = useState<ReadonlyMap<string, string>>(() => new Map())
  const ordinary = deduplicateHandoffBundle(bundle, !excludeContextPack)
  const contextPackCount = bundle.contextPack ? 1 : 0
  const fileOffset = contextPackCount
  const diffOffset = fileOffset + ordinary.files.length
  const shellOffset = diffOffset + ordinary.pendingDiffs.length
  const itemCount = shellOffset + shellCommands.length

  // The textarea is an editing surface, not the summary's authority. Read mode and
  // send both consume `summaryDraft`, so leaving edit mode can never expose or forward
  // the stale bundle value.
  const summary = useRef<TextareaRenderable | null>(null)

  const onSummaryChange = useCallback((): void => {
    const editor = summary.current
    if (editor) setSummaryDraft(editor.plainText)
  }, [])

  const toggle = useCallback(
    (index: number): void => {
      if (bundle.contextPack && index === 0) {
        setExcludeContextPack((excluded) => !excluded)
        return
      }
      const file = ordinary.files[index - fileOffset]
      if (file) {
        setExcludedFiles((paths) => without(paths, file.path))
        return
      }
      const diff = ordinary.pendingDiffs[index - diffOffset]
      if (diff) {
        setExcludedDiffs((ids) => without(ids, diff.toolCallId))
        return
      }
      const command = shellCommands[index - shellOffset]
      if (command) setExcludedCommands((ids) => without(ids, command.id))
    },
    [bundle.contextPack, diffOffset, fileOffset, ordinary.files, ordinary.pendingDiffs, shellCommands, shellOffset],
  )

  const targetRows = useMemo(() => modelEffortValueRows(targetConfigOptions), [targetConfigOptions])
  const clampedTargetSelected = Math.min(targetSelected, Math.max(targetRows.length - 1, 0))
  // Preserve the target's advertised section order (model before effort in normal ACP
  // advertisements) rather than the order in which the developer happened to choose
  // values. This lets a model change refresh before the chosen effort is applied.
  const targetConfigEdits = useMemo(
    () =>
      targetConfigOptions.flatMap((option) => {
        const value = targetConfig.get(option.id)
        return value === undefined ? [] : [{ configId: option.id, value }]
      }),
    [targetConfig, targetConfigOptions],
  )

  const chooseTargetConfig = useCallback((row: ModelEffortValueRow | undefined): void => {
    if (!row) return
    setTargetConfig((previous) => {
      const next = new Map(previous)
      // Choosing the target's already-confirmed value restores the no-change path.
      if (row.value === row.option.currentValue) next.delete(row.option.id)
      else next.set(row.option.id, row.value)
      return next
    })
    setEditingTargetConfig(false)
  }, [])

  const send = useCallback((): void => {
    void flow.confirm({
      summary: summaryDraft,
      excludedFiles,
      excludedDiffs,
      excludedCommands,
      excludeContextPack,
      targetConfig: targetConfigEdits,
    })
  }, [excludeContextPack, excludedCommands, excludedDiffs, excludedFiles, flow, summaryDraft, targetConfigEdits])

  const onKey = useCallback(
    (key: KeyEvent): void => {
      // Clarification owns top modal priority. Stand down before preventDefault or any
      // local curation so this exact mounted preview can resume with its draft intact.
      if (clarificationOpen) return

      // A permission request blocks an agent mid-turn. It outranks a bundle that is
      // waiting on nothing but the developer, so hand it the keyboard whole.
      if (approvalOpen) return

      if (editing) {
        // Every other key is text. Claiming Escape here is what keeps the textarea's
        // own Escape handling - and the composer's interrupt - out of the editor.
        if (matchHandoffCommand(key) !== "cancel") return
        key.preventDefault()
        setEditing(false)
        return
      }

      // Modal: no key reaches the composer while a bundle is on screen, whether or not
      // this dialog claims it. The shell stands its own chords down separately.
      key.preventDefault()

      if (editingTargetConfig) {
        // Reuse the live selector's navigation, but not its mid-conversation confirm:
        // this target has not received the hand-off prompt yet, so its configuration is
        // applied only as part of the explicit send.
        switch (matchModelSelectCommand(key)) {
          case "prev-option":
            targetSelectedRef.current = Math.max(targetSelectedRef.current - 1, 0)
            setTargetSelected(targetSelectedRef.current)
            return
          case "next-option":
            targetSelectedRef.current = Math.min(targetSelectedRef.current + 1, Math.max(targetRows.length - 1, 0))
            setTargetSelected(targetSelectedRef.current)
            return
          case "confirm":
            chooseTargetConfig(targetRows[Math.min(targetSelectedRef.current, Math.max(targetRows.length - 1, 0))])
            return
          case "cancel":
            setEditingTargetConfig(false)
            return
          default:
            return
        }
      }

      switch (matchHandoffCommand(key)) {
        case "prev-item":
          setSelected((index) => Math.max(index - 1, 0))
          return
        case "next-item":
          // `Math.max(..., 0)` matters when the bundle carries no files and no diffs:
          // `itemCount - 1` would otherwise walk the highlight to -1.
          setSelected((index) => Math.min(index + 1, Math.max(itemCount - 1, 0)))
          return
        case "toggle-item":
          toggle(selected)
          return
        case "edit-target-config":
          setEditingTargetConfig(true)
          return
        case "edit-summary":
          setEditing(true)
          return
        case "confirm":
          send()
          return
        case "cancel":
          flow.cancel()
          return
        default:
          return
      }
    },
    [approvalOpen, chooseTargetConfig, clarificationOpen, clampedTargetSelected, editing, editingTargetConfig, flow, itemCount, selected, send, targetRows, toggle],
  )
  useKeyboard(onKey)

  const sourceName = controller.runtime(sourceSessionId)?.displayName ?? sourceSessionId
  const targetName = controller.runtime(targetSessionId)?.displayName ?? targetSessionId
  const selectedContextPack = bundle.contextPack && selected === 0 ? bundle.contextPack : undefined
  const selectedDiff = ordinary.pendingDiffs[selected - diffOffset]
  const selectedCommand = shellCommands[selected - shellOffset]

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        // Bound the dialog to the viewport, so the summary and the diff below have
        // something to shrink against rather than growing off the bottom of the screen
        // and taking the hint - and the Enter that sends - with them.
        maxHeight: Math.max(height - 2, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={handoffTitleFor(sourceName, targetName)}
      titleColor={palette.accent}
    >
      <text style={{ flexShrink: 0 }} fg={bundle.redactionCount > 0 ? palette.accent : palette.muted}>
        {redactionNotice(bundle.redactionCount)}
      </text>
      <text style={{ flexShrink: 0 }}>
        <span fg={palette.muted}>{`${TARGET_HEADROOM_LABEL}: `}</span>
        <span fg={palette.text}>{targetHeadroom.label}</span>
        {selectedTargetHeadroom === null ? null : (
          <>
            <span fg={palette.text}>{` ${"█".repeat(targetHeadroom.filled)}`}</span>
            <span fg={palette.muted}>{"░".repeat(targetHeadroom.cells - targetHeadroom.filled)}</span>
          </>
        )}
      </text>

      <SectionHeading>{TARGET_CONFIG_HEADING}</SectionHeading>
      {editingTargetConfig ? (
        <ModelEffortControl
          options={targetConfigOptions}
          highlighted={clampedTargetSelected}
          outgoing={targetConfig}
          emptyNotice={NO_TARGET_CONFIG_OPTIONS}
        />
      ) : (
        <TargetConfigSummary options={targetConfigOptions} outgoing={targetConfig} />
      )}

      <SectionHeading>{SUMMARY_HEADING}</SectionHeading>
      {editing ? (
        <textarea
          ref={summary}
          focused
          style={{
            height: SUMMARY_ROWS,
            minHeight: MIN_SUMMARY_ROWS,
            flexShrink: 1,
            wrapMode: "word",
            textColor: palette.text,
            cursorColor: palette.accent,
          }}
          initialValue={summaryDraft}
          onContentChange={onSummaryChange}
        />
      ) : (
        <box
          style={{
            height: SUMMARY_ROWS,
            minHeight: MIN_SUMMARY_ROWS,
            flexShrink: 1,
            overflow: "hidden",
          }}
        >
          <Markdown content={summaryDraft} fg={palette.muted} />
        </box>
      )}

      {bundle.contextPack ? (
        <>
          <SectionHeading>{CONTEXT_PACK_HEADING}</SectionHeading>
          <ItemRow
            label={`${CONTEXT_PACK_LABEL} (${bundle.contextPack.bytes} bytes)`}
            kept={!excludeContextPack}
            highlighted={!editing && !editingTargetConfig && selected === 0}
          />
        </>
      ) : null}

      <SectionHeading>{FILES_HEADING}</SectionHeading>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {ordinary.files.length === 0 ? (
          <EmptySection />
        ) : (
          ordinary.files.map((file, index) => (
            <ItemRow
              key={file.path}
              label={`${file.path} (${file.reason})`}
              href={fileProvenanceTarget(file.path, renderer.capabilities?.hyperlinks ?? false)}
              kept={!excludedFiles.has(file.path)}
              highlighted={!editing && !editingTargetConfig && selected === fileOffset + index}
            />
          ))
        )}
      </box>

      <SectionHeading>{DIFFS_HEADING}</SectionHeading>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {ordinary.pendingDiffs.length === 0 ? (
          <EmptySection />
        ) : (
          ordinary.pendingDiffs.map((diff, index) => (
            <ItemRow
              key={diff.toolCallId}
              label={diff.path}
              kept={!excludedDiffs.has(diff.toolCallId)}
              highlighted={!editing && !editingTargetConfig && selected === diffOffset + index}
            />
          ))
        )}
      </box>

      {bundle.shell ? (
        <>
          <SectionHeading>{SHELL_HEADING}</SectionHeading>
          <text style={{ flexShrink: 0 }} fg={palette.muted}>{` cwd ${bundle.shell.cwd}`}</text>
          <box style={{ flexDirection: "column", flexShrink: 0 }}>
            {shellCommands.map((command, index) => (
              <ItemRow
                key={command.id}
                label={shellCommandLabel(command)}
                kept={!excludedCommands.has(command.id)}
                highlighted={!editing && !editingTargetConfig && selected === shellOffset + index}
              />
            ))}
          </box>
        </>
      ) : null}

      {/*
        Only the highlighted diff is drawn, and it is the only part of the dialog
        allowed to lose rows. Showing every diff at once would push the hint - and the
        row the developer is deciding about - off a 24-row terminal, and they cannot
        judge a diff they have not selected anyway.
      */}
      {selectedContextPack && !excludeContextPack && !editing && !editingTargetConfig
        ? <SelectedContextPack payload={selectedContextPack.payload} />
        : null}
      {selectedDiff && !editing && !editingTargetConfig ? <SelectedDiff diff={selectedDiff} /> : null}
      {selectedCommand && !editing && !editingTargetConfig ? <SelectedCommand command={selectedCommand} /> : null}

      <text style={{ flexShrink: 0 }} fg={palette.muted}>
        {editing ? HANDOFF_EDIT_HINT : editingTargetConfig ? HANDOFF_CONFIG_HINT : HANDOFF_HINT}
      </text>
    </box>
  )
}

/** A set with `value` toggled in or out. Never mutates the set it is given. */
function without(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(values)
  if (!next.delete(value)) next.add(value)
  return next
}

/** One section's label, set apart from the rows beneath it. */
function SectionHeading({ children }: { children: string }): ReactNode {
  const palette = usePalette()
  return (
    <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.accent}>
      {children}
    </text>
  )
}

/** A section the source session gave nothing for. */
function EmptySection(): ReactNode {
  const palette = usePalette()
  return <text fg={palette.muted}>{` ${NO_FILES}`}</text>
}

/**
 * The compact, always-visible summary of the target's config. Expanding it with `m`
 * reuses the full task-06 control without pushing the preview's file/diff curation off
 * a short terminal.
 */
function TargetConfigSummary({ options, outgoing }: { options: ConfigOption[]; outgoing: ReadonlyMap<string, string> }): ReactNode {
  const palette = usePalette()
  const selectable = options.filter((option) => option.options.length > 0)
  if (selectable.length === 0) return <text fg={palette.muted}>{NO_TARGET_CONFIG_OPTIONS}</text>

  return (
    <text style={{ flexShrink: 0 }}>
      {selectable.map((option, index) => {
        const selected = outgoing.get(option.id)
        const value = selected ?? option.currentValue
        const name = option.options.find((candidate) => candidate.value === value)?.name ?? value
        const changed = selected !== undefined
        return (
          <Fragment key={option.id}>
            {index > 0 ? <span fg={palette.muted}>{"  "}</span> : null}
            <span fg={palette.muted}>{`${option.label}: `}</span>
            <span fg={changed ? palette.accent : palette.tool.completed}>{`${changed ? TARGET_MARK : CURRENT_MARK} ${name}`}</span>
          </Fragment>
        )
      })}
    </text>
  )
}

/** One keepable row: the highlight, the keep/drop box, and what it names. */
function ItemRow({ label, href, kept, highlighted }: { label: string; href?: string; kept: boolean; highlighted: boolean }): ReactNode {
  const palette = usePalette()
  const labelColor = kept ? palette.text : palette.muted
  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={palette.accent}>{highlighted ? ITEM_MARKER : " "}</span>
      <span fg={kept ? palette.tool.completed : palette.muted}>{` ${kept ? KEPT_BOX : DROPPED_BOX} `}</span>
      {href ? (
        <a href={href} fg={labelColor}>
          {label}
        </a>
      ) : (
        <span fg={labelColor}>{label}</span>
      )}
    </text>
  )
}

/** Inspect the exact sealed payload as one indivisible attachment. */
function SelectedContextPack({ payload }: { payload: string }): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 1, marginTop: 1, overflow: "hidden" }}>
      <Markdown content={payload} fg={palette.text} />
    </box>
  )
}

/** The highlighted pending diff, in the same unified view the approval overlay shows. */
function SelectedDiff({ diff }: { diff: PendingDiff }): ReactNode {
  return (
    <box style={{ flexDirection: "column", flexShrink: 1, marginTop: 1, overflow: "hidden" }}>
      <ToolCallDiffView diff={{ path: diff.path, unified: diff.unified }} />
    </box>
  )
}

/** The command row keeps status textual so color is never the only signal. */
function shellCommandLabel(command: ShellCommandRecord): string {
  return `${command.command} (${command.exitCode === null ? "running" : `exit ${command.exitCode}`})`
}

/** Show the highlighted command's redacted output without expanding every row at once. */
function SelectedCommand({ command }: { command: ShellCommandRecord }): ReactNode {
  const palette = usePalette()
  return (
    <box style={{ flexDirection: "column", flexShrink: 1, marginTop: 1, overflow: "hidden" }}>
      <text fg={palette.muted}>Output</text>
      <text fg={palette.text}>{command.output.length > 0 ? command.output : "(no output)"}</text>
    </box>
  )
}
