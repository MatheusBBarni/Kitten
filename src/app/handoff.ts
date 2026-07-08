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
 * - **Nothing is ever auto-sent.** `begin` only opens the preview; only `confirm`
 *   reaches an agent. The redactor is biased to false negatives on purpose, and the
 *   preview is the second line of defence against forwarding a credential (ADR-002,
 *   TechSpec "Known Risks"). A code path from keystroke to `sendPrompt` that skips
 *   the preview would defeat that, so there is none.
 * - **The bundle arrives redacted.** `assemble` redacts as it builds (task_06), so
 *   this module never redacts again and never has plaintext secrets to leak.
 * - **Direction is derived, not configured.** The target is simply the agent that is
 *   not focused, which is what makes hand-off and hand-back one flow rather than two.
 *
 * Layering (ADR-003): assembly is pure core, and the send goes through
 * `ControllerActions`, so nothing here touches an `AgentConnection` or the ACP SDK.
 */

import type { PromptBlock, PromptResult } from "../agent/agentConnection.ts"
import { createDeterministicAssembler, type BundleAssembler } from "../core/bundleAssembler.ts"
import type { HandoffBundle, PendingDiff } from "../core/types.ts"
import { nextAgentId } from "./actions.ts"
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
}

/** The untouched starting point: the bundle exactly as assembled. */
export function createHandoffEdits(bundle: HandoffBundle): HandoffEdits {
  return { summary: bundle.summary, excludedFiles: new Set(), excludedDiffs: new Set() }
}

/** The files that survive the developer's edits, in bundle order. */
export function includedFiles(bundle: HandoffBundle, edits: HandoffEdits): HandoffBundle["files"] {
  return bundle.files.filter((file) => !edits.excludedFiles.has(file.path))
}

/** The pending diffs that survive the developer's edits, in bundle order. */
export function includedDiffs(bundle: HandoffBundle, edits: HandoffEdits): PendingDiff[] {
  return bundle.pendingDiffs.filter((diff) => !edits.excludedDiffs.has(diff.toolCallId))
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
  if (summary.length === 0 && files.length === 0 && diffs.length === 0) return []

  const blocks: PromptBlock[] = [text(HANDOFF_INSTRUCTION)]
  if (summary.length > 0) blocks.push(text(summary))
  if (files.length > 0) {
    const lines = files.map((file) => `- ${file.path} (${file.reason})`)
    blocks.push(text([FILES_HEADING, ...lines].join("\n")))
  }
  for (const diff of diffs) {
    blocks.push(text(`${pendingDiffHeading(diff.path)}\n${diff.unified}`))
  }
  return blocks
}

function text(value: string): PromptBlock {
  return { type: "text", text: value }
}

/** The hand-off orchestration the shell binds its keystroke to. */
export interface HandoffFlow {
  /**
   * Assemble a bundle from the focused agent's session and open the preview over it.
   *
   * Returns whether the preview opened. It does not when an overlay already owns the
   * screen, when the source has said nothing worth carrying, or when the agent that
   * would receive the bundle never came up.
   */
  begin(): boolean
  /**
   * Send the curated bundle to the target and move focus to it.
   *
   * Resolves with the target's stop reason, or `null` when nothing was sent (the
   * preview is closed, or the developer emptied the bundle). Focus moves as soon as
   * the prompt is dispatched, not when the turn ends: `sendPrompt` records the user's
   * turn synchronously and only then awaits the agent.
   */
  confirm(edits: HandoffEdits): Promise<PromptResult | null>
  /** Close the preview. Nothing is sent, and focus stays where it was. */
  cancel(): void
}

export interface HandoffFlowOptions {
  controller: SessionController
  /** The assembly strategy. Defaults to the V1 deterministic one (ADR-002). */
  assembler?: BundleAssembler
}

/** Build the hand-off flow over one controller. */
export function createHandoffFlow(options: HandoffFlowOptions): HandoffFlow {
  const { controller } = options
  const assembler = options.assembler ?? createDeterministicAssembler()
  const { store, actions } = controller

  return {
    begin(): boolean {
      const state = store.getState()
      // An overlay already owns the screen. The shell stands its chords down while one
      // is open, so this is a guard rather than a reachable path - but the flow is
      // callable without the shell, and clobbering a pending permission request with a
      // preview would strand the agent waiting on it.
      if (state.overlays.approval !== null || state.overlays.handoffPreview !== null) return false

      const sourceAgentId = state.focusedAgentId
      const targetAgentId = nextAgentId(sourceAgentId)
      // No session on the far side means no one to hand to.
      if (!controller.isReady(targetAgentId)) return false

      const session = state.sessions[sourceAgentId]
      if (session.turns.length === 0) return false

      // `assemble` redacts as it builds; the bundle is safe to display as it arrives.
      store.openHandoffPreview({ sourceAgentId, targetAgentId, bundle: assembler.assemble(session, targetAgentId) })
      return true
    },

    confirm(edits: HandoffEdits): Promise<PromptResult | null> {
      const overlay = store.getState().overlays.handoffPreview
      if (!overlay) return Promise.resolve(null)

      const blocks = composeHandoffBlocks(overlay.bundle, edits)
      // Nothing left to carry. Leave the preview up rather than sending an empty
      // hand-off the developer would have to undo by hand.
      if (blocks.length === 0) return Promise.resolve(null)

      store.closeHandoffPreview()
      // Address the target explicitly: focus has not moved yet, and it must not have -
      // `sendPrompt` writes the user's turn into whichever agent it is given.
      const sent = actions.sendPrompt(blocks, overlay.targetAgentId)
      actions.switchFocus(overlay.targetAgentId)
      return sent
    },

    cancel(): void {
      store.closeHandoffPreview()
    },
  }
}
