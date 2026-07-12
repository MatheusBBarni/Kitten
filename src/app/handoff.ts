/**
 * The hand-off: assemble, curate, send, switch.
 *
 * This is the product (PRD F3/F4). One keystroke turns the focused agent's live
 * session into a `HandoffBundle` - a bounded transcript excerpt, the files it
 * touched, and the diffs it proposed - shows it to the developer for curation, and
 * on confirm sends the curated bundle to the *other* agent as a prompt and moves
 * focus with it. Both sessions stay live for the whole run, so the same mechanism
 * run again from the target hands the task back.
 *
 * Three properties are load-bearing:
 *
 * - **Nothing is ever auto-sent.** `begin` only opens the target picker or the
 *   preview; only `confirm` reaches an agent. The redactor is biased to false
 *   negatives on purpose, and the preview is the second line of defence against
 *   forwarding a credential (ADR-002, TechSpec "Known Risks"). A code path from
 *   keystroke to `sendPrompt` that skips the preview would defeat that, so there is none.
 * - **The bundle arrives redacted.** `assemble` redacts as it builds, so this module
 *   never redacts again and never has plaintext secrets to leak.
 * - **The target is the developer's chosen session (task_06).** Across a fleet the
 *   recipient is picked explicitly: `begin` opens a target picker when more than one
 *   session could receive the bundle, and the developer chooses. When exactly one
 *   session can receive it the picker is skipped and the preview opens straight away,
 *   so the two-agent hand-off stays one keystroke and hand-back is the same flow
 *   pointed the other way.
 *
 * Layering (ADR-003): assembly is pure core, and the send goes through
 * `ControllerActions`, so nothing here touches an `AgentConnection` or the ACP SDK.
 */

import type { PromptBlock, PromptResult } from "../agent/agentConnection.ts"
import { createDeterministicAssembler, type BundleAssembler } from "../core/bundleAssembler.ts"
import { editedCharCount } from "../core/telemetryHeuristics.ts"
import {
  visibleConfigOptions,
  type HandoffBundle,
  type PendingDiff,
  type SessionId,
  type SessionState,
  type ShellCommandRecord,
  type ShellSnapshot,
} from "../core/types.ts"
import { selectHasOpenOverlay } from "../store/selectors.ts"
import type { TelemetryRecorder } from "../telemetry/recorder.ts"
import type { SessionController } from "./controller.ts"

/**
 * The first thing the receiving agent reads.
 *
 * The bundle is a transcript excerpt written from the *source* agent's point of view,
 * so without a framing sentence the target would read it as its own history. This
 * says whose work it is and what to do with it - the single `continue` intent V1
 * supports (ADR-002).
 */
export const HANDOFF_INSTRUCTION =
  "Continue this task. Another coding agent was working on it and handed it over to you. " +
  "Everything below is the context it carried across, curated by the developer."

/** Heading of the referenced-file block. */
export const FILES_HEADING = "Files referenced so far:"

/** Heading of the curated shell snapshot block. */
export const SHELL_HEADING = "Shell context:"

/** Heading of one pending-diff block. Each diff gets its own block. */
export function pendingDiffHeading(path: string): string {
  return `Pending diff (proposed, not yet applied) - ${path}`
}

/**
 * The developer's curation of a bundle, as the preview overlay collects it.
 *
 * The bundle itself is never mutated: it stays the immutable record of what the
 * source session actually contained, and these edits are laid over it at compose
 * time. Files and diffs are dropped by identity rather than by index, so a re-render
 * of the preview cannot silently re-point an exclusion at a different row.
 */
export interface HandoffEdits {
  /** The summary as the developer left it. May be trimmed, rewritten, or emptied. */
  summary: string
  /** Paths the developer dropped from the referenced-file list. */
  excludedFiles: ReadonlySet<string>
  /** `toolCallId`s of the pending diffs the developer dropped. */
  excludedDiffs: ReadonlySet<string>
  /** Command ids the developer dropped from the shell snapshot. */
  excludedCommands: ReadonlySet<string>
  /** Target model/effort changes to apply before the receiving agent gets the prompt. */
  targetConfig: { configId: string; value: string }[]
}

/** The untouched starting point: the bundle exactly as assembled. */
export function createHandoffEdits(bundle: HandoffBundle): HandoffEdits {
  return {
    summary: bundle.summary,
    excludedFiles: new Set(),
    excludedDiffs: new Set(),
    excludedCommands: new Set(),
    targetConfig: [],
  }
}

/** The files that survive the developer's edits, in bundle order. */
export function includedFiles(bundle: HandoffBundle, edits: HandoffEdits): HandoffBundle["files"] {
  return bundle.files.filter((file) => !edits.excludedFiles.has(file.path))
}

/** The pending diffs that survive the developer's edits, in bundle order. */
export function includedDiffs(bundle: HandoffBundle, edits: HandoffEdits): PendingDiff[] {
  return bundle.pendingDiffs.filter((diff) => !edits.excludedDiffs.has(diff.toolCallId))
}

/** The shell commands that survive the developer's edits, in execution order. */
export function includedCommands(bundle: HandoffBundle, edits: HandoffEdits): ShellCommandRecord[] {
  return bundle.shell?.commands.filter((command) => !edits.excludedCommands.has(command.id)) ?? []
}

/**
 * Turn a curated bundle into the prompt the target agent receives.
 *
 * One block per part rather than one wall of text: the summary, the file list, and
 * each diff on its own, so a long diff cannot bury the framing sentence above it.
 *
 * Returns no blocks at all when the developer has emptied the bundle - blank summary,
 * every file and diff dropped. A prompt carrying only the instruction would tell the
 * target to continue a task it has been told nothing about, which is worse than not
 * sending, so `confirm` treats an empty compose as "nothing to hand off".
 */
export function composeHandoffBlocks(bundle: HandoffBundle, edits: HandoffEdits): PromptBlock[] {
  const summary = edits.summary.trim()
  const files = includedFiles(bundle, edits)
  const diffs = includedDiffs(bundle, edits)
  const commands = includedCommands(bundle, edits)
  if (summary.length === 0 && files.length === 0 && diffs.length === 0 && commands.length === 0) return []

  const blocks: PromptBlock[] = [text(HANDOFF_INSTRUCTION)]
  if (summary.length > 0) blocks.push(text(summary))
  if (files.length > 0) {
    const lines = files.map((file) => `- ${file.path} (${file.reason})`)
    blocks.push(text([FILES_HEADING, ...lines].join("\n")))
  }
  for (const diff of diffs) {
    blocks.push(text(`${pendingDiffHeading(diff.path)}\n${diff.unified}`))
  }
  if (bundle.shell && commands.length > 0) {
    blocks.push(text(renderShellContext(bundle.shell.cwd, commands)))
  }
  return blocks
}

function renderShellContext(cwd: string, commands: readonly ShellCommandRecord[]): string {
  const records = commands.map((record) =>
    [
      `Command: ${record.command}`,
      `Exit code: ${record.exitCode ?? "running"}`,
      `Output:\n${record.output}`,
    ].join("\n"),
  )
  return [SHELL_HEADING, `Working directory: ${cwd}`, ...records].join("\n\n")
}

function text(value: string): PromptBlock {
  return { type: "text", text: value }
}

/** The hand-off orchestration the shell binds its keystroke to. */
export type HandoffBlockedReason = "overlay-open" | "no-target" | "empty-source"

/** Whether a hand-off started, or the exact guard that prevented it. */
export type HandoffBeginResult = { ok: true } | { ok: false; reason: HandoffBlockedReason }

export interface HandoffFlow {
  /**
   * Start a hand-off from the focused session (task_06).
   *
   * With more than one session able to receive the bundle, this opens the target
   * picker and returns `{ ok: true }`; the developer then chooses a recipient with
   * {@link chooseTarget}. With exactly one possible recipient it skips the picker and
   * opens the redacted preview directly - the two-agent hand-off stays one keystroke.
   *
   * Returns the corresponding blocked reason, opening nothing, when an overlay already
   * owns the screen, when the source has said nothing worth carrying, or when no other
   * session is ready to receive the bundle.
   */
  begin(): HandoffBeginResult
  /**
   * Choose the target session from the picker and open the redacted preview over the
   * bundle assembled for it. A no-op returning `false` when the picker is not open, or
   * when the chosen session is the source, is not ready, or has nothing to carry.
   */
  chooseTarget(targetSessionId: SessionId): boolean
  /**
   * Send the curated bundle to the target and move focus to it.
   *
   * Resolves with the target's stop reason, or `null` when nothing was sent (the
   * preview is closed, or the developer emptied the bundle). Focus moves as soon as
   * the prompt is dispatched, not when the turn ends: `sendPrompt` records the user's
   * turn synchronously and only then awaits the agent.
   */
  confirm(edits: HandoffEdits): Promise<PromptResult | null>
  /** Close the target picker or the preview. Nothing is sent, and focus stays put. */
  cancel(): void
}

export interface HandoffFlowOptions {
  controller: SessionController
  /** The assembly strategy. Defaults to the V1 deterministic one (ADR-002). */
  assembler?: BundleAssembler
  /**
   * The telemetry recorder. Optional: when omitted (or disabled) the flow behaves
   * identically and records nothing. The flow is the source of the hand-off metrics
   * (`handoff_invoked`, `handoff_sent`, `handoff_repeat`, `bundle_edit_chars`, and
   * `effort_linked_handoff`) and it arms the re-explanation watch on the target once a
   * bundle is sent.
   */
  recorder?: TelemetryRecorder
}

/** Build the hand-off flow over one controller. */
export function createHandoffFlow(options: HandoffFlowOptions): HandoffFlow {
  const { controller, recorder } = options
  const assembler = options.assembler ?? createDeterministicAssembler()
  const { store, actions } = controller
  let pendingShell: ShellSnapshot | undefined

  /** The ready sessions, in display order, that could receive a hand-off from `source`. */
  function readyRecipients(order: readonly SessionId[], source: SessionId): SessionId[] {
    return order.filter((id) => id !== source && controller.isReady(id))
  }

  /**
   * Assemble the bundle for `source` -> `target` and open the redacted preview. The
   * bundle header names the target provider kind (unchanged by the identity split), and
   * `assemble` redacts as it builds, so the bundle is safe to display as it arrives.
   */
  function openPreview(source: SessionState, targetSessionId: SessionId, shell: ShellSnapshot): void {
    const target = store.getState().sessions[targetSessionId]!
    store.openHandoffPreview({
      sourceSessionId: source.id,
      targetSessionId,
      bundle: assembler.assemble(source, target.providerKind, shell),
      // Snapshot the target's allowed options. The preview owns its local outgoing
      // choices until confirm, so cancelling cannot mutate a live target session.
      targetConfigOptions: visibleConfigOptions(target.configOptions),
    })
  }

  return {
    begin(): HandoffBeginResult {
      const state = store.getState()
      // An overlay already owns the screen. The shell stands its chords down while one
      // is open, so this is a guard rather than a reachable path - but the flow is
      // callable without the shell, and clobbering a pending permission request with a
      // preview would strand the agent waiting on it.
      if (selectHasOpenOverlay(state)) return { ok: false, reason: "overlay-open" }

      const sourceSessionId = state.focusedSessionId
      const session = state.sessions[sourceSessionId]
      if (!session || session.turns.length === 0) return { ok: false, reason: "empty-source" }

      // No ready session on the far side means no one to hand to.
      const recipients = readyRecipients(state.order, sourceSessionId)
      if (recipients.length === 0) return { ok: false, reason: "no-target" }

      // Snapshot the pure shell slice at the start of the hand-off. If a target picker
      // opens, later shell events cannot change what the developer is about to curate.
      pendingShell = state.shell
      // The hand-off is under way whichever branch we take, so the metric fires once here.
      recorder?.handoffInvoked()
      if (recipients.length === 1) {
        // A single possible recipient: skip the picker and open the preview straight
        // away, so the two-agent hand-off (and hand-back) stays one keystroke.
        openPreview(session, recipients[0]!, pendingShell)
        pendingShell = undefined
      } else {
        // "The other agent" is ambiguous across a fleet: let the developer choose which
        // session receives the bundle (task_06) before the redacted preview opens.
        store.openHandoffTarget({ sourceSessionId })
      }
      return { ok: true }
    },

    chooseTarget(targetSessionId: SessionId): boolean {
      const state = store.getState()
      const picker = state.overlays.handoffTarget
      // Only reachable from an open picker; the source is the session it was opened for.
      if (!picker) return false
      const sourceSessionId = picker.sourceSessionId
      if (targetSessionId === sourceSessionId || !controller.isReady(targetSessionId)) return false

      const session = state.sessions[sourceSessionId]
      if (!session || session.turns.length === 0) return false

      // Trade the picker for the preview in one step: nothing is sent, only displayed.
      store.closeHandoffTarget()
      openPreview(session, targetSessionId, pendingShell ?? state.shell)
      pendingShell = undefined
      return true
    },

    async confirm(edits: HandoffEdits): Promise<PromptResult | null> {
      const overlay = store.getState().overlays.handoffPreview
      if (!overlay) return null

      const blocks = composeHandoffBlocks(overlay.bundle, edits)
      // Nothing left to carry. Leave the preview up rather than sending an empty
      // hand-off the developer would have to undo by hand.
      if (blocks.length === 0) return null

      store.closeHandoffPreview()
      // A target receives a fresh prompt, so there is no mid-conversation degrade
      // warning here. Apply each requested setting first, in the order the preview
      // supplied, so the target observes its chosen configuration before its hand-off.
      for (const config of edits.targetConfig) {
        await actions.setSessionConfigOption(config.configId, config.value, overlay.targetSessionId)
      }
      // Address the target explicitly: focus has not moved yet, and it must not have -
      // `sendPrompt` writes the user's turn into whichever session it is given.
      const sent = actions.sendPrompt(blocks, overlay.targetSessionId)
      // Count only snapshots that actually cross the boundary after curation. The
      // recorder receives no cwd, command text, output, or command count.
      if (includedCommands(overlay.bundle, edits).length > 0) recorder?.shellSnapshotAttached()
      // Record after the send so the bundle's own user turn is already applied: only a
      // *later* developer message can then trip the re-explanation heuristic. The edit
      // volume is the change the developer made to the summary in the preview.
      recorder?.handoffSent({
        targetSessionId: overlay.targetSessionId,
        editChars: editedCharCount(overlay.bundle.summary, edits.summary),
      })
      // A non-empty target configuration is the PRD's hand-off correlation signal.
      // The recorder stores only the target session id, never the selected values.
      if (edits.targetConfig.length > 0) recorder?.effortLinkedHandoff(overlay.targetSessionId)
      actions.switchFocus(overlay.targetSessionId)
      return sent
    },

    cancel(): void {
      // Either overlay may be up (the picker before a target is chosen, the preview
      // after); closing both is idempotent and always leaves focus where it was.
      store.closeHandoffTarget()
      store.closeHandoffPreview()
      pendingShell = undefined
    },
  }
}
