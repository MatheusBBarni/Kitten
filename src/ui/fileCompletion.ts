/** Pure prompt-local decisions for repository file completion. */

/** An unquoted `@` token whose complete replacement range still owns the cursor. */
export interface FileToken {
  readonly start: number
  readonly end: number
  readonly filter: string
}

/** The fixed number of ranked file matches exposed to the selector. */
export const MAX_VISIBLE_FILE_MATCHES = 8

/**
 * Return the unquoted file token at the cursor.
 *
 * A trigger is valid only at the beginning of a whitespace-delimited token. Quotes
 * and another `@` disarm parsing so inserted references, email addresses, and
 * embedded ordinary text never reopen completion.
 */
export function fileTokenAt(text: string, cursorOffset: number): FileToken | null {
  const cursor = Math.max(0, Math.min(cursorOffset, text.length))
  let start = cursor
  while (start > 0 && !/\s/.test(text[start - 1]!)) start -= 1
  let end = cursor
  while (end < text.length && !/\s/.test(text[end]!)) end += 1

  const token = text.slice(start, end)
  if (
    cursor === start
    || !token.startsWith("@")
    || token.indexOf("@", 1) !== -1
    || token.includes('"')
  ) return null

  return { start, end, filter: token.slice(1) }
}

interface RankedFileMatch {
  readonly path: string
  readonly normalizedPath: string
  readonly priority: number
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Filter safe relative paths case-insensitively and return every match in stable
 * rank order without changing the caller's candidate list.
 */
export function rankFileMatches(paths: readonly string[], filter: string): string[] {
  const normalizedFilter = filter.toLowerCase()
  const ranked: RankedFileMatch[] = []

  for (const path of paths) {
    const normalizedPath = path.toLowerCase()
    const basenamePrefix = basename(normalizedPath).startsWith(normalizedFilter)
    if (!basenamePrefix && !normalizedPath.includes(normalizedFilter)) continue
    ranked.push({ path, normalizedPath, priority: basenamePrefix ? 0 : 1 })
  }

  ranked.sort((left, right) =>
    left.priority - right.priority
    || lexicalCompare(left.normalizedPath, right.normalizedPath)
    || lexicalCompare(left.path, right.path)
  )
  return ranked.map(({ path }) => path)
}

/** Return the immutable eight-row display subset of an already-ranked match list. */
export function visibleFileMatches(matches: readonly string[]): string[] {
  return matches.slice(0, MAX_VISIBLE_FILE_MATCHES)
}

/** Format one safe relative path as an explicit, unambiguous visible reference. */
export function formatFileReference(path: string): string {
  return /[\s"\\]/.test(path) ? `@${JSON.stringify(path)}` : `@${path}`
}

/** Escape suppression marker for one dismissed token start. */
export interface FileTokenSuppression {
  readonly tokenStart: number
}

/** Suppress reopening while this exact token remains active. */
export function suppressFileToken(token: FileToken): FileTokenSuppression {
  return { tokenStart: token.start }
}

/**
 * Advance suppression after content, cursor, or focus changes.
 *
 * A missing token means its trigger was removed or the cursor left it. A different
 * start means a new token began. Focus changes always clear prompt-local state.
 */
export function updateFileTokenSuppression(
  suppression: FileTokenSuppression | null,
  token: FileToken | null,
  focusChanged = false,
): FileTokenSuppression | null {
  if (suppression === null || focusChanged || token === null || token.start !== suppression.tokenStart) return null
  return suppression
}

/** Whether the active token is still the one Escape dismissed. */
export function isFileTokenSuppressed(
  suppression: FileTokenSuppression | null,
  token: FileToken | null,
): boolean {
  return suppression !== null && updateFileTokenSuppression(suppression, token) !== null
}

/** One accepted visible reference tracked only until correction or submission. */
export interface PendingFileReference {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly sessionId: string
}

/** Pure result consumed by the editor's content-free correction event decision. */
export interface PendingReferenceUpdate {
  readonly pending: readonly PendingFileReference[]
  readonly corrected: boolean
}

interface ChangedRange {
  readonly start: number
  readonly previousEnd: number
  readonly delta: number
}

/** Find the minimal changed range without retaining either draft. */
function changedRange(previousText: string, nextText: string): ChangedRange | null {
  if (previousText === nextText) return null

  const sharedLimit = Math.min(previousText.length, nextText.length)
  let start = 0
  while (start < sharedLimit && previousText[start] === nextText[start]) start += 1

  let suffix = 0
  while (
    suffix < sharedLimit - start
    && previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) suffix += 1

  const previousEnd = previousText.length - suffix
  const nextEnd = nextText.length - suffix
  return { start, previousEnd, delta: nextEnd - previousEnd }
}

/**
 * Shift unaffected pending ranges and remove every accepted reference overlapped by
 * the minimal edit. The boolean reports at most one correction for this edit.
 */
export function updatePendingFileReferences(
  previousText: string,
  nextText: string,
  pending: readonly PendingFileReference[],
): PendingReferenceUpdate {
  const change = changedRange(previousText, nextText)
  if (change === null) return { pending, corrected: false }

  let corrected = false
  const nextPending: PendingFileReference[] = []
  for (const reference of pending) {
    if (change.previousEnd <= reference.start) {
      nextPending.push({
        ...reference,
        start: reference.start + change.delta,
        end: reference.end + change.delta,
      })
      continue
    }
    if (change.start >= reference.end) {
      nextPending.push(reference)
      continue
    }
    corrected = true
  }

  return { pending: nextPending, corrected }
}

/** Submission forgets accepted references without classifying them as corrections. */
export function clearPendingFileReferencesOnSubmit(
  _pending: readonly PendingFileReference[],
): PendingReferenceUpdate {
  return { pending: [], corrected: false }
}
