/**
 * Pattern-based secret redaction for hand-off bundles.
 *
 * A hand-off forwards a source agent's transcript and diffs to a *different*
 * agent process, so any credential sitting in that text would be handed over
 * with it. This module strips the credentials before the bundle is ever shown
 * (PRD F5). It is part of the pure Domain Core (ADR-003): no I/O, no ACP SDK,
 * no UI. Given the same input it always produces the same output and the same
 * redaction count.
 *
 * Design bias: **false negatives over false positives.** A missed secret is
 * caught by the human preview, which is a mandatory step and never bypassed
 * (TechSpec "Known Risks"). An over-eager redactor, by contrast, silently
 * corrupts the bundle the receiving agent has to work from. So the patterns
 * are anchored to recognizable credential shapes rather than to any long
 * token, and the generic `key = value` pattern additionally requires the value
 * to contain a digit.
 *
 * Redaction is line-oriented. That is what keeps a secret inside a unified
 * diff from corrupting the diff: only the matched credential is replaced, so
 * the `+`/`-`/context prefix and the hunk headers around it survive intact.
 */

/** The literal text substituted for every redacted secret. */
export const REDACTION_PLACEHOLDER = "[REDACTED]"

/** The result of one redaction pass: rewritten text plus how many secrets went. */
export interface RedactionResult {
  text: string
  count: number
}

/** Strips credentials from arbitrary text. Pure; safe to reuse across calls. */
export interface SecretRedactor {
  redact(text: string): RedactionResult
}

/**
 * One credential shape.
 *
 * If `regex` declares a named `secret` capture group, only that group is
 * replaced and the rest of the match is preserved (so `Authorization: Bearer
 * <token>` keeps its header name). Otherwise the whole match is replaced. A
 * pattern without the `g` flag is made global on construction, since a
 * credential can appear more than once on a line.
 */
export interface SecretPattern {
  name: string
  regex: RegExp
}

/** Opens a PEM block. Tolerates a leading unified-diff prefix. */
const PEM_BEGIN = /^[+\- ]?-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----\s*$/
/** Closes a PEM block. Tolerates a leading unified-diff prefix. */
const PEM_END = /^[+\- ]?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----\s*$/
/** The unified-diff line markers a PEM body line may carry. */
const DIFF_PREFIXES = "+- "

/**
 * The credential shapes Kitten recognizes, applied in order.
 *
 * Order matters: the most specific vendor prefixes run before the broader
 * shapes, so `sk-ant-...` is reported as an Anthropic key rather than being
 * swallowed by the generic OpenAI-style `sk-` pattern. Once a match has been
 * replaced the placeholder cannot be matched again (see `applyPattern`), so a
 * single secret is only ever counted once.
 */
export function defaultSecretPatterns(): SecretPattern[] {
  return [
    { name: "anthropic_api_key", regex: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
    { name: "openai_api_key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
    { name: "github_token", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
    { name: "github_fine_grained_token", regex: /\bgithub_pat_[A-Za-z0-9_]{30,}/g },
    { name: "aws_access_key_id", regex: /\b(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z0-9]{16}\b/g },
    { name: "google_api_key", regex: /\bAIza[A-Za-z0-9_-]{35}\b/g },
    { name: "slack_token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
    { name: "stripe_key", regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
    // Three base64url segments: a signed JWT / session token.
    { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
    // Keep the scheme, drop the credential.
    { name: "http_auth_header", regex: /\b(?:Bearer|Basic)\s+(?<secret>[A-Za-z0-9._~+/=-]{16,})/gi },
    {
      // `API_KEY = "aBc123..."`, `token: aBc123...`, `.env`-style assignments.
      // The value must contain a digit, which keeps prose such as
      // `the token: something` out of the net.
      name: "credential_assignment",
      regex:
        /[A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|credential|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*\s*[:=]\s*(?<quote>["']?)(?<secret>(?=[A-Za-z0-9_+/=.~-]*\d)[A-Za-z0-9_+/=.~-]{12,})\k<quote>/gi,
    },
  ]
}

/** Build a redactor. Pass `patterns` to narrow or extend the default set. */
export function createSecretRedactor(patterns: SecretPattern[] = defaultSecretPatterns()): SecretRedactor {
  const compiled = patterns.map(toGlobal)

  return {
    redact(text: string): RedactionResult {
      if (text === "") return { text: "", count: 0 }

      let count = 0
      let insidePemBlock = false
      const lines = text.split("\n").map((line) => {
        if (insidePemBlock) {
          if (PEM_END.test(line)) insidePemBlock = false
          // The body is masked; the END marker itself is structure, not secret.
          return insidePemBlock ? maskPemBody(line) : line
        }
        if (PEM_BEGIN.test(line)) {
          insidePemBlock = true
          // One key block counts as one secret, however many body lines it spans.
          count += 1
          return line
        }
        const result = applyPatterns(line, compiled)
        count += result.count
        return result.text
      })

      return { text: lines.join("\n"), count }
    },
  }
}

/**
 * A credential can occur twice on one line, so every pattern scans globally.
 * `String.replace` resets a global regex's `lastIndex`, which is what makes a
 * compiled pattern safe to share across calls.
 */
function toGlobal(pattern: SecretPattern): SecretPattern {
  if (pattern.regex.global) return pattern
  return { name: pattern.name, regex: new RegExp(pattern.regex.source, `${pattern.regex.flags}g`) }
}

/**
 * Replace a PEM body line's payload while keeping any unified-diff prefix, so
 * a private key pasted into a diff is stripped without unbalancing the hunk.
 *
 * The prefix is taken positionally rather than by regex: an optional-group
 * pattern would backtrack on a blank body line and swallow the `+`/`-` marker
 * along with the payload. A line whose payload is blank is left exactly as it
 * is, since there is nothing there to hide.
 */
function maskPemBody(line: string): string {
  const prefix = line.length > 0 && DIFF_PREFIXES.includes(line[0] as string) ? line.slice(0, 1) : ""
  if (line.slice(prefix.length).trim() === "") return line
  return `${prefix}${REDACTION_PLACEHOLDER}`
}

/** Run every pattern over one line, accumulating the number of replacements. */
function applyPatterns(line: string, patterns: SecretPattern[]): RedactionResult {
  let text = line
  let count = 0
  for (const pattern of patterns) {
    const result = applyPattern(text, pattern)
    text = result.text
    count += result.count
  }
  return { text, count }
}

/**
 * Apply one pattern. When the pattern captures a named `secret` group, only
 * that substring is replaced inside the match; otherwise the whole match goes.
 * An already-placeholder value is left alone so overlapping patterns cannot
 * double-count the same secret.
 */
function applyPattern(line: string, pattern: SecretPattern): RedactionResult {
  let count = 0

  const text = line.replace(pattern.regex, (match: string, ...rest: unknown[]) => {
    const groups = rest[rest.length - 1]
    const secret = isGroups(groups) ? groups.secret : undefined

    if (secret === undefined) {
      if (match === REDACTION_PLACEHOLDER) return match
      count += 1
      return REDACTION_PLACEHOLDER
    }

    if (secret === REDACTION_PLACEHOLDER) return match
    const at = match.lastIndexOf(secret)
    if (at === -1) return match
    count += 1
    return match.slice(0, at) + REDACTION_PLACEHOLDER + match.slice(at + secret.length)
  })

  return { text, count }
}

/** `String.replace` passes the named-group object last, but only if one exists. */
function isGroups(value: unknown): value is Record<string, string | undefined> {
  return typeof value === "object" && value !== null
}
