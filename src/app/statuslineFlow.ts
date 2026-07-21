/**
 * Focused-session orchestration for conversational statusline proposals.
 *
 * The ordinary prompt action remains the only agent boundary: it records the
 * product request in the selected transcript and settles after buffered agent
 * messages flush. This flow only reads the resulting store projection and hands
 * one new agent turn to the pure statusline parser.
 */

import { parseStatuslineProposalReply, type StatuslineProposalResult } from "../core/statusline.ts"
import type { SessionId, Turn } from "../core/types.ts"
import type { AppStore } from "../store/appStore.ts"
import type { ControllerActions } from "./actions.ts"

/** Product-owned interpretation contract. It contains field identifiers, never resolved session values. */
export const STATUSLINE_PROPOSAL_INSTRUCTION = `Propose one safe Kitten statusline layout for the developer's request.

Your entire reply must be exactly one lowercase-json fenced block with no prose before or after it:
\`\`\`json
{"statusline":{"separator":" · ","line":["FOLDER",{"kind":"BRANCH","color":"purple"},{"kind":"ELLIPSIS_BRANCH","maxChars":24,"color":"#0A8BCF"},"MODEL"]}}
\`\`\`

The statusline object must contain exactly "separator" and "line". Select and order only the fields the request needs. Each field may appear at most once. The only permitted line item forms are:
- Legacy uncolored simple fields are the strings "FOLDER", "FULL_PATH", "BRANCH", "PROVIDER", "MODEL", "EFFORT", "HELP_TEXT", and "CONTEXT".
- A colored simple field is exactly {"kind":"FOLDER","color":"purple"}, with "kind" set to one of those simple field identifiers. Use the legacy string form when a simple field is uncolored.
- ELLIPSIS_BRANCH is exactly {"kind":"ELLIPSIS_BRANCH","maxChars":24} with optional "color". maxChars must be an integer from 4 to 80.

Color is either a known CSS color name or exactly six hexadecimal digits in #RRGGBB form. The separator must be printable single-line text no longer than 16 grapheme clusters.

Do not emit scripts, commands, templates, ANSI or terminal control sequences, executable output, extra keys, or unsupported fields. Do not resolve or include current folder/path, branch, provider, model, effort, help-text, context, other runtime session values, or transcript values; emit only the declarative field identifiers and formatting choices.`

export interface StatuslineFlow {
  /** Request and strictly parse one proposal from an explicitly selected ready session. */
  request(text: string, sessionId: SessionId): Promise<StatuslineProposalResult>
}

export interface StatuslineFlowOptions {
  readonly actions: Pick<ControllerActions, "sendPrompt">
  readonly store: Pick<AppStore, "getState">
}

/** Keep the developer's text visible in the intentional transcript while preserving the product-owned boundary. */
export function buildStatuslineProposalPrompt(text: string): string {
  return `${STATUSLINE_PROPOSAL_INSTRUCTION}\n\nDeveloper request:\n${text}`
}

/** Build the proposal flow over injected read models and the normal controller action facade. */
export function createStatuslineFlow({ actions, store }: StatuslineFlowOptions): StatuslineFlow {
  return {
    async request(text: string, sessionId: SessionId): Promise<StatuslineProposalResult> {
      const before = store.getState()
      const session = before.sessions[sessionId]
      const conversation = before.workspace.conversations[sessionId]
      if (!session || conversation?.availability.kind !== "ready") {
        return unavailable("The selected agent session is unavailable. Choose a recovery layout or try again later.")
      }

      const transcriptBoundary = session.turns.length
      let terminalResult: Awaited<ReturnType<ControllerActions["sendPrompt"]>>
      try {
        terminalResult = await actions.sendPrompt(buildStatuslineProposalPrompt(text), sessionId, { persist: false })
      } catch {
        return unavailable("The statusline request could not be sent. Choose a recovery layout or try again.")
      }

      if (!terminalResult) {
        return unavailable("The selected agent did not complete the statusline request. Choose a recovery layout or try again.")
      }
      if (terminalResult.stopReason !== "end_turn") {
        return unavailable(terminalReason(terminalResult.stopReason))
      }

      const after = store.getState()
      const completedSession = after.sessions[sessionId]
      if (!completedSession || after.workspace.conversations[sessionId]?.availability.kind !== "ready") {
        return unavailable("The selected agent session became unavailable. Choose a recovery layout or try again.")
      }

      const responses = completedSession.turns
        .slice(transcriptBoundary)
        .filter((turn): turn is Extract<Turn, { kind: "agent" }> => turn.kind === "agent")

      if (responses.length === 0) {
        return unavailable("The agent returned no statusline proposal. Choose a recovery layout or try again.")
      }
      if (responses.length !== 1) {
        return {
          kind: "invalid-response",
          reason: "The agent returned multiple statusline responses; one sole fenced JSON reply is required.",
        }
      }
      if (responses[0]!.text.trim().length === 0) {
        return unavailable("The agent returned no statusline proposal. Choose a recovery layout or try again.")
      }

      return parseStatuslineProposalReply(responses[0]!.text)
    },
  }
}

function unavailable(reason: string): StatuslineProposalResult {
  return { kind: "unavailable", reason }
}

function terminalReason(stopReason: string): string {
  if (stopReason === "cancelled") {
    return "The statusline request was cancelled. Choose a recovery layout or try again."
  }
  if (stopReason === "refusal") {
    return "The agent declined the statusline request. Choose a recovery layout or try again."
  }
  return "The agent stopped before completing the statusline request. Choose a recovery layout or try again."
}
