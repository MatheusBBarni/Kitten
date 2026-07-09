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
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useRef, useState, type ReactNode } from "react"

import type { HandoffFlow } from "../app/handoff.ts"
import type { PendingDiff } from "../core/types.ts"
import type { HandoffPreviewOverlay } from "../store/appStore.ts"
import { selectHandoffPreview, selectIsApprovalOpen } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { HANDOFF_EDIT_HINT, HANDOFF_HINT, matchHandoffCommand } from "./keymap.ts"
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
export const FILES_HEADING = "Referenced files"
export const DIFFS_HEADING = "Pending diffs"

/** Shown in place of a section that the source session gave nothing for. */
export const NO_FILES = "None"

/** The marker on the highlighted row. Matches the approval overlay and the status strip. */
export const ITEM_MARKER = "▸"

/** How a kept row and a dropped row are told apart at a glance. */
export const KEPT_BOX = "[x]"
export const DROPPED_BOX = "[ ]"

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
  const { height } = useTerminalDimensions()
  const approvalOpen = useAppSelector(selectIsApprovalOpen)

  const { bundle, sourceAgentId, targetAgentId } = overlay
  const itemCount = bundle.files.length + bundle.pendingDiffs.length

  const [selected, setSelected] = useState(0)
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(() => new Set())
  const [excludedDiffs, setExcludedDiffs] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState(false)

  // The textarea's own edit buffer is the summary draft, read once on send - the same
  // arrangement the composer uses, and for the same reason: a keystroke repaints the
  // renderable without waking the reconciler to re-render the diff below it.
  const summary = useRef<TextareaRenderable | null>(null)

  const toggle = useCallback(
    (index: number): void => {
      const file = bundle.files[index]
      if (file) {
        setExcludedFiles((paths) => without(paths, file.path))
        return
      }
      const diff = bundle.pendingDiffs[index - bundle.files.length]
      if (diff) setExcludedDiffs((ids) => without(ids, diff.toolCallId))
    },
    [bundle],
  )

  const send = useCallback((): void => {
    void flow.confirm({
      summary: summary.current?.plainText ?? bundle.summary,
      excludedFiles,
      excludedDiffs,
    })
  }, [bundle, excludedDiffs, excludedFiles, flow])

  const onKey = useCallback(
    (key: KeyEvent): void => {
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
    [approvalOpen, editing, flow, itemCount, selected, send, toggle],
  )
  useKeyboard(onKey)

  const sourceName = controller.runtime(sourceAgentId)?.displayName ?? sourceAgentId
  const targetName = controller.runtime(targetAgentId)?.displayName ?? targetAgentId
  const selectedDiff = bundle.pendingDiffs[selected - bundle.files.length]

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

      <SectionHeading>{SUMMARY_HEADING}</SectionHeading>
      <textarea
        ref={summary}
        focused={editing}
        style={{
          height: SUMMARY_ROWS,
          minHeight: MIN_SUMMARY_ROWS,
          flexShrink: 1,
          wrapMode: "word",
          textColor: editing ? palette.text : palette.muted,
          cursorColor: palette.accent,
        }}
        initialValue={bundle.summary}
      />

      <SectionHeading>{FILES_HEADING}</SectionHeading>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {bundle.files.length === 0 ? (
          <EmptySection />
        ) : (
          bundle.files.map((file, index) => (
            <ItemRow
              key={file.path}
              label={`${file.path} (${file.reason})`}
              kept={!excludedFiles.has(file.path)}
              highlighted={!editing && selected === index}
            />
          ))
        )}
      </box>

      <SectionHeading>{DIFFS_HEADING}</SectionHeading>
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {bundle.pendingDiffs.length === 0 ? (
          <EmptySection />
        ) : (
          bundle.pendingDiffs.map((diff, index) => (
            <ItemRow
              key={diff.toolCallId}
              label={diff.path}
              kept={!excludedDiffs.has(diff.toolCallId)}
              highlighted={!editing && selected === bundle.files.length + index}
            />
          ))
        )}
      </box>

      {/*
        Only the highlighted diff is drawn, and it is the only part of the dialog
        allowed to lose rows. Showing every diff at once would push the hint - and the
        row the developer is deciding about - off a 24-row terminal, and they cannot
        judge a diff they have not selected anyway.
      */}
      {selectedDiff && !editing ? <SelectedDiff diff={selectedDiff} /> : null}

      <text style={{ flexShrink: 0 }} fg={palette.muted}>
        {editing ? HANDOFF_EDIT_HINT : HANDOFF_HINT}
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

/** One keepable row: the highlight, the keep/drop box, and what it names. */
function ItemRow({ label, kept, highlighted }: { label: string; kept: boolean; highlighted: boolean }): ReactNode {
  const palette = usePalette()
  return (
    <text style={{ flexShrink: 0 }}>
      <span fg={palette.accent}>{highlighted ? ITEM_MARKER : " "}</span>
      <span fg={kept ? palette.tool.completed : palette.muted}>{` ${kept ? KEPT_BOX : DROPPED_BOX} `}</span>
      <span fg={kept ? palette.text : palette.muted}>{label}</span>
    </text>
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
