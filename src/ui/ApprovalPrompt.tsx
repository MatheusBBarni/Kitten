/**
 * The approval overlay: the gate between an agent's intent and the user's files.
 *
 * An ACP `requestPermission` blocks the agent mid-turn until the user answers it. The
 * controller parks that request in the store's single approval slot (task_07); this
 * overlay is what the slot looks like, and `respondPermission` is how the answer gets
 * back to the agent that is waiting on it. Nothing else in the cockpit can grant an
 * agent write access, which is the whole point of the PRD's control story.
 *
 * Three properties follow from that, and each one is load-bearing:
 *
 * - **It is modal.** Every keypress is consumed, so while a decision is pending nothing
 *   reaches the prompt editor. A user cannot approve an edit by accident while typing.
 *   Modality takes two halves, because global key listeners fire in the order they
 *   mounted and this overlay mounts last: `preventDefault` here stops the focused
 *   textarea, and the shell stands its own chords down while the slot is full
 *   (`selectIsApprovalOpen`). Only the renderer's Ctrl+C outranks both.
 * - **It does not close itself.** `respondPermission` settles the request and the
 *   controller then either opens the next queued one or clears the slot. Closing here
 *   too would clobber a freshly-opened second request in the same tick.
 * - **It shows the whole proposed action** - which agent, in which working directory,
 *   what kind, what title, and the unified diff when one is attached - because a
 *   decision made on a truncated description is not consent. The session title and
 *   directory are what keep a permission answer from ever landing in the wrong
 *   repository when several agents - even two of the same provider - run at once
 *   (task_07, ADR-004).
 *
 * It renders as a conditional, absolutely-positioned box: the React binding ships no
 * Portal (ADR-004).
 */

import type { KeyEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useState, type ReactNode } from "react"

import type { PermissionOptionView, PermissionOutcome } from "../agent/agentConnection.ts"
import type { ApprovalOverlay } from "../store/appStore.ts"
import { selectApprovalOverlay } from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { APPROVAL_HINT, approvalOptionIndex, matchApprovalCommand } from "./keymap.ts"
import { usePalette } from "./theme.ts"
import { TOOL_KIND_LABELS, ToolCallDiffView } from "./ToolCallRow.tsx"

/** The overlay's frame title. The agent's own name follows it. */
export const APPROVAL_TITLE = "Permission request"

/** What a request whose tool call named no title is called. Never blank. */
export const UNTITLED_ACTION = "Untitled action"

/** The marker on the highlighted option. Matches the status strip's focus marker. */
export const OPTION_MARKER = "▸"

/** How the overlay titles itself for one agent: the phrase the tests and the user read. */
export function approvalTitleFor(displayName: string): string {
  return `${APPROVAL_TITLE} - ${displayName}`
}

/**
 * The approval overlay, or nothing at all.
 *
 * Reading the slot here rather than in the shell keeps the overlay self-contained: the
 * cockpit mounts `<ApprovalPrompt />` unconditionally and this component decides. The
 * dialog below it is mounted only while a request is pending, so its keyboard listener
 * exists for exactly as long as it is allowed to swallow keys.
 */
export function ApprovalPrompt(): ReactNode {
  const overlay = useAppSelector(selectApprovalOverlay)
  if (!overlay) return null
  return <ApprovalDialog overlay={overlay} />
}

/** The dialog proper. Mounted only when the approval slot holds a request. */
function ApprovalDialog({ overlay }: { overlay: ApprovalOverlay }): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const { sessionId, title, cwd, request } = overlay
  const { options, toolCall } = request

  const [selected, setSelected] = useState(0)

  // Requests queue behind one slot, so the next one replaces this overlay's props
  // without remounting it. Re-home the highlight on the new options rather than
  // leaving it pointing at an index that belonged to the previous request.
  const [shown, setShown] = useState(overlay)
  if (shown !== overlay) {
    setShown(overlay)
    setSelected(0)
  }

  const answer = useCallback(
    (outcome: PermissionOutcome): void => {
      // Answer at most once per displayed request. A second synchronous keypress
      // (key-repeat, or two bytes arriving in one stdin chunk) would otherwise re-fire
      // this stale closure before React re-homes the overlay onto the next queued
      // request, and the controller would settle *that* request - which was never shown
      // to the user - with this one's outcome. Re-reading the store the way
      // HandoffPreview.confirm does gates it: once the slot no longer holds our request,
      // the answer has already been given.
      if (controller.store.getState().overlays.approval !== overlay) return
      // The controller settles the agent's promise and advances the queue, which is
      // what closes this overlay. See the module comment.
      controller.actions.respondPermission(outcome)
    },
    [controller, overlay],
  )

  const choose = useCallback(
    (index: number): void => {
      const option = options[index]
      if (!option) return
      answer({ outcome: "selected", optionId: option.optionId })
    },
    [answer, options],
  )

  const onKey = useCallback(
    (key: KeyEvent): void => {
      // Modal: no key reaches the focused textarea while an agent waits on an answer,
      // whether or not this dialog claims it. The shell stands down separately.
      key.preventDefault()

      const digit = approvalOptionIndex(key)
      if (digit !== null) {
        choose(digit)
        return
      }

      switch (matchApprovalCommand(key)) {
        case "prev-option":
          setSelected((index) => Math.max(index - 1, 0))
          return
        case "next-option":
          setSelected((index) => Math.min(index + 1, options.length - 1))
          return
        case "confirm":
          choose(selected)
          return
        case "cancel":
          answer({ outcome: "cancelled" })
          return
        default:
          return
      }
    },
    [answer, choose, options.length, selected],
  )
  useKeyboard(onKey)

  const displayName = controller.runtime(sessionId)?.displayName ?? sessionId
  const kind = toolCall.kind ?? "other"

  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        left: 2,
        right: 2,
        // Bound the dialog to the viewport so the diff below has something to shrink
        // against. Unbounded, a hundred-line diff would grow the box straight off the
        // bottom of the screen, taking the options and the hint with it.
        maxHeight: Math.max(height - 2, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.status.awaiting_approval,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={approvalTitleFor(displayName)}
      titleColor={palette.status.awaiting_approval}
    >
      {/*
        Which session is asking, and the directory it works in. The provider display
        name in the frame title is not enough on its own - two sessions of the same
        provider share it - so the session's own title and working directory are what
        make an approval unmistakably attributable to one agent and one repository
        (task_07). The directory is shown in full: a basename can collide across clones,
        the path cannot.
      */}
      <text style={{ flexShrink: 0 }}>
        <span fg={palette.text}>{title}</span>
        <span fg={palette.muted}>{`  ${cwd}`}</span>
      </text>

      <text style={{ flexShrink: 0 }}>
        <span fg={palette.muted}>{`${TOOL_KIND_LABELS[kind]} `}</span>
        <span fg={palette.text}>{toolCall.title ?? UNTITLED_ACTION}</span>
      </text>

      {/*
        The diff is the only part of the dialog allowed to lose rows. It is the largest
        and the least essential: a truncated diff still tells the user what file is
        being changed, whereas an option list pushed off the bottom of the screen leaves
        them with a decision they cannot make and an agent that never unblocks.
      */}
      {toolCall.diff ? (
        <box style={{ flexDirection: "column", flexShrink: 1, overflow: "hidden" }}>
          <ToolCallDiffView diff={toolCall.diff} />
        </box>
      ) : null}

      <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
        {options.map((option, index) => (
          <OptionRow key={option.optionId} option={option} ordinal={index + 1} highlighted={index === selected} />
        ))}
      </box>

      <text style={{ flexShrink: 0 }} fg={palette.muted}>
        {APPROVAL_HINT}
      </text>
    </box>
  )
}

/** One choosable option: its digit, its name, and whether the highlight is on it. */
function OptionRow({
  option,
  ordinal,
  highlighted,
}: {
  option: PermissionOptionView
  ordinal: number
  highlighted: boolean
}): ReactNode {
  const palette = usePalette()
  return (
    <text>
      <span fg={highlighted ? palette.accent : palette.muted}>{highlighted ? OPTION_MARKER : " "}</span>
      <span fg={palette.muted}>{` ${ordinal}. `}</span>
      <span fg={highlighted ? palette.text : palette.muted}>{option.name}</span>
    </text>
  )
}
