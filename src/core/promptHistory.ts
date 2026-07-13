/**
 * Pure, protocol-free policy for one session's current-run prompt recall.
 *
 * Entries retain their submitted text exactly and stay chronological. Navigation
 * returns an explicit selection result because `null` means "leave the composer
 * unchanged", while `""` means "clear it after the newest recalled prompt".
 */

/** Fixed prompt-history bound; recording entry 51 evicts only the oldest entry. */
export const MAX_PROMPT_HISTORY = 50

/** Immutable prompt-history state owned by a later session-state integration. */
export interface PromptHistoryState {
  readonly entries: readonly string[]
  readonly cursor: number | null
}

/** Domain-shaped events accepted by the pure prompt-history reducer. */
export type PromptHistoryEvent =
  | { kind: "prompt_history"; action: "record"; text: string }
  | { kind: "prompt_history"; action: "previous" }
  | { kind: "prompt_history"; action: "next" }

/** Direction of recall navigation from the composer boundary. */
export type PromptHistoryDirection = "previous" | "next"

/** Composer replacement and indicator data derived from a history transition. */
export interface PromptHistorySelection {
  /** `null` preserves the composer; an empty string explicitly clears it. */
  readonly text: string | null
  /** Zero-based index into chronological entries while recall is active. */
  readonly historyIndex: number | null
  readonly total: number
}

/** A navigation transition keeps the next immutable state and its selection together. */
export interface PromptHistoryNavigationResult {
  readonly state: PromptHistoryState
  readonly selection: PromptHistorySelection
}

/** Create an empty, inactive prompt-history state. */
export function createPromptHistoryState(): PromptHistoryState {
  return { entries: [], cursor: null }
}

/**
 * Record one accepted, nonblank composer submission.
 *
 * The blank check never changes retained text. Exact adjacent duplicates reuse the
 * existing entries array, and every accepted record leaves recall mode.
 */
export function recordPromptHistory(
  state: PromptHistoryState,
  text: string,
): PromptHistoryState {
  if (text.trim().length === 0) return state

  if (state.entries.at(-1) === text) {
    return state.cursor === null ? state : { ...state, cursor: null }
  }

  return {
    entries: [...state.entries, text].slice(-MAX_PROMPT_HISTORY),
    cursor: null,
  }
}

/** Select the active recalled prompt, or report that the composer should not change. */
export function selectPromptHistory(state: PromptHistoryState): PromptHistorySelection {
  if (state.cursor === null) return noReplacement(state.entries.length)

  const text = state.entries[state.cursor]
  if (text === undefined) return noReplacement(state.entries.length)

  return {
    text,
    historyIndex: state.cursor,
    total: state.entries.length,
  }
}

/**
 * Navigate prompt recall without wrapping.
 *
 * Previous clamps at the oldest prompt. Next clamps by leaving recall mode after
 * the newest prompt and returns an explicit empty-string replacement exactly once.
 */
export function navigatePromptHistory(
  state: PromptHistoryState,
  direction: PromptHistoryDirection,
): PromptHistoryNavigationResult {
  if (state.entries.length === 0) {
    return { state, selection: noReplacement(0) }
  }

  if (direction === "previous") {
    const cursor = state.cursor === null
      ? state.entries.length - 1
      : Math.max(0, state.cursor - 1)
    const nextState = cursor === state.cursor ? state : { ...state, cursor }
    return { state: nextState, selection: selectPromptHistory(nextState) }
  }

  if (state.cursor === null) {
    return { state, selection: noReplacement(state.entries.length) }
  }

  if (state.cursor < state.entries.length - 1) {
    const nextState = { ...state, cursor: state.cursor + 1 }
    return { state: nextState, selection: selectPromptHistory(nextState) }
  }

  return {
    state: { ...state, cursor: null },
    selection: { text: "", historyIndex: null, total: state.entries.length },
  }
}

/** Fold one prompt-history event into state; outer reducers can delegate here directly. */
export function promptHistoryReducer(
  state: PromptHistoryState,
  event: PromptHistoryEvent,
): PromptHistoryState {
  switch (event.action) {
    case "record":
      return recordPromptHistory(state, event.text)
    case "previous":
    case "next":
      return navigatePromptHistory(state, event.action).state
    default:
      return assertNever(event)
  }
}

function noReplacement(total: number): PromptHistorySelection {
  return { text: null, historyIndex: null, total }
}

/** Exhaustiveness guard: a compile error here means a history event is unhandled. */
function assertNever(event: never): never {
  throw new Error(`Unhandled prompt-history event: ${JSON.stringify(event)}`)
}
