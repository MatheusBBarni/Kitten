/**
 * Pure Context Pack custody rules.
 *
 * Materialization, digest calculation, clocks, persistence, recipient evidence,
 * and protocol/runtime effects are supplied by callers. This module only validates
 * immutable values and computes deterministic transitions.
 */

import type { SecretRedactor } from "./secretRedactor.ts"
import {
  CONTEXT_BRIEF_SECTION_KEYS,
  type ContextBrief,
  type ContextBriefSection,
  type ContextDiffScope,
  type BuilderContextPackMutation,
  type ContextPackAssemblyResult,
  type ContextPackDraftResult,
  type ContextPackInstructions,
  type ContextPackMutation,
  type ContextPackMutationResult,
  type ContextPackRestoreResult,
  type ContextPackReviewCandidate,
  type ContextPackSealResult,
  type ContextPackSourceFence,
  type ContextPackSourceReference,
  type ContextPackValidationIssue,
  type ContextPackValidationResult,
  type ContextSelection,
  type DraftContextPack,
  type DraftContextPackManifest,
  type DurableSealedContextPack,
  type MaterializedContextArtifact,
  type RecipientFit,
  type RecipientFitEvidence,
  type RevisionFencedContextPackMutation,
  type SealedContextPack,
} from "./types.ts"

export const DEFAULT_CONTEXT_PACK_BUDGET = 80_000
export const CONTEXT_PACK_MANIFEST_VERSION = 1 as const

const SHA256_DIGEST = /^[a-f0-9]{64}$/
const DIFF_SCOPES: readonly ContextDiffScope[] = ["staged", "unstaged", "pending"]
const TEXT_ENCODER = new TextEncoder()

/** Create a valid immutable draft without materializing any source content. */
export function createDraft(
  original: string,
  options: {
    readonly mode?: ContextPackInstructions["mode"]
    readonly discovered?: string
    readonly budgetLimit?: number
  } = {},
): ContextPackDraftResult {
  const draft: DraftContextPack = {
    revision: 0,
    instructions: {
      original,
      mode: options.mode ?? "augment",
      discovered: options.discovered ?? "",
    },
    budget: {
      unit: "estimated_tokens",
      limit: options.budgetLimit ?? DEFAULT_CONTEXT_PACK_BUDGET,
    },
    brief: emptyContextBrief(),
    selections: [],
    stale: { kind: "fresh" },
  }

  const validation = validateDraft(draft)
  return validation.kind === "valid"
    ? deepFreeze({ kind: "created", draft: cloneDraft(draft) })
    : deepFreeze({ kind: "invalid", issues: validation.issues })
}

/** Validate all runtime invariants, including the absence of raw-content fields. */
export function validateDraft(draft: DraftContextPack): ContextPackValidationResult {
  const issues: ContextPackValidationIssue[] = []

  if (!hasExactKeys(draft, ["revision", "instructions", "budget", "brief", "selections", "stale"])) {
    issues.push({ code: "unsupported_fields" })
  }
  if (!isNonnegativeInteger(draft.revision)) issues.push({ code: "invalid_revision" })
  validateInstructions(draft.instructions, issues)
  validateBudget(draft.budget, issues)
  validateBrief(draft.brief, issues)
  validateStaleState(draft.stale, issues)

  if (!Array.isArray(draft.selections)) {
    issues.push({ code: "invalid_selection" })
  } else {
    const keys = new Set<string>()
    for (const [selectionIndex, selection] of draft.selections.entries()) {
      const before = issues.length
      validateSelection(selection, issues, selectionIndex)
      if (issues.length !== before) continue
      const key = contextSelectionKey(selection)
      if (keys.has(key)) issues.push({ code: "duplicate_selection", selectionIndex })
      keys.add(key)
    }
  }

  return issues.length === 0
    ? deepFreeze({ kind: "valid" })
    : deepFreeze({ kind: "invalid", issues })
}

/** Stable selection identity used for replacement, removal, materialization, and ordering. */
export function contextSelectionKey(selection: ContextSelection): string {
  switch (selection.kind) {
    case "full_file":
      return JSON.stringify([selection.kind, selection.path])
    case "file_slice":
      return JSON.stringify([
        selection.kind,
        selection.path,
        selection.range.startLine,
        selection.range.endLine,
      ])
    case "diff":
      return JSON.stringify([selection.kind, selection.scope, selection.path, selection.source.identity])
  }
}

/** Operator edits commit against the current value and therefore invalidate stale child reads. */
export function applyOperatorMutation(
  draft: DraftContextPack,
  mutation: ContextPackMutation,
): ContextPackMutationResult {
  const current = validateDraft(draft)
  if (current.kind === "invalid") return deepFreeze({ kind: "invalid", issues: current.issues })

  const mutated = mutateDraft(draft, mutation)
  if (mutated.kind === "invalid") return mutated

  const validation = validateDraft(mutated.draft)
  return validation.kind === "valid"
    ? deepFreeze({ kind: "applied", draft: cloneDraft(mutated.draft) })
    : deepFreeze({ kind: "invalid", issues: validation.issues })
}

/** A builder mutation is accepted only against the exact revision it observed. */
export function applyBuilderMutation(
  draft: DraftContextPack,
  input: RevisionFencedContextPackMutation,
): ContextPackMutationResult {
  if (input.readRevision !== draft.revision) {
    return deepFreeze({
      kind: "stale",
      readRevision: input.readRevision,
      currentRevision: draft.revision,
    })
  }
  const mutationKind = (input.mutation as { readonly kind?: unknown }).kind
  switch (mutationKind) {
    case "set_discovered_instructions": {
      const mutation = input.mutation as Extract<BuilderContextPackMutation, { kind: "set_discovered_instructions" }>
      return applyOperatorMutation(draft, {
        kind: "set_instructions",
        instructions: { ...draft.instructions, discovered: mutation.discovered },
      })
    }
    case "set_brief_section":
    case "upsert_selection":
    case "remove_selection": {
      const mutation = input.mutation as Extract<
        BuilderContextPackMutation,
        { kind: "set_brief_section" | "upsert_selection" | "remove_selection" }
      >
      return applyOperatorMutation(draft, mutation)
    }
    default:
      return invalidMutation([{ code: "unauthorized_mutation" }])
  }
}

/** Convert a validated draft to its metadata-only persistence and refinement shape. */
export function draftToManifest(draft: DraftContextPack): DraftContextPackManifest {
  return deepFreeze({
    version: CONTEXT_PACK_MANIFEST_VERSION,
    revision: draft.revision,
    instructions: { ...draft.instructions },
    budget: { ...draft.budget },
    brief: { ...draft.brief },
    selections: [...draft.selections].sort(compareSelections).map(cloneSelection),
  })
}

/** Strictly restore metadata while forcing a fresh source review. */
export function restoreManifest(input: unknown): ContextPackRestoreResult {
  if (!hasExactKeys(input, ["version", "revision", "instructions", "budget", "brief", "selections"])) {
    return invalidRestore([{ code: "unsupported_fields" }])
  }
  if (input.version !== CONTEXT_PACK_MANIFEST_VERSION) {
    return invalidRestore([{ code: "unsupported_fields" }])
  }

  const candidate = {
    revision: input.revision,
    instructions: input.instructions,
    budget: input.budget,
    brief: input.brief,
    selections: input.selections,
    stale: { kind: "needs_revalidation" },
  } as DraftContextPack
  const validation = validateDraft(candidate)
  return validation.kind === "valid"
    ? deepFreeze({ kind: "restored", draft: cloneDraft(candidate) })
    : invalidRestore(validation.issues)
}

/** Refinement copies reviewed metadata into a distinct revision-fenced draft. */
export function startFreshFromSealed(sealed: SealedContextPack): ContextPackDraftResult {
  const restored = restoreManifest(sealed.manifest)
  if (restored.kind === "invalid") return restored

  const draft: DraftContextPack = {
    ...restored.draft,
    revision: Math.max(sealed.revision, restored.draft.revision) + 1,
    stale: { kind: "needs_revalidation" },
  }
  const validation = validateDraft(draft)
  return validation.kind === "valid"
    ? deepFreeze({ kind: "created", draft: cloneDraft(draft) })
    : deepFreeze({ kind: "invalid", issues: validation.issues })
}

/**
 * Assemble a complete exact candidate from bounded artifacts.
 * Any missing, extra, stale, or malformed input returns no candidate at all.
 */
export function assembleCandidate(
  draft: DraftContextPack,
  artifacts: readonly MaterializedContextArtifact[],
  redactor: SecretRedactor,
): ContextPackAssemblyResult {
  const validation = validateDraft(draft)
  if (validation.kind === "invalid") {
    return deepFreeze({ kind: "blocked", reason: "invalid_draft", issues: validation.issues })
  }
  if (draft.stale.kind === "stale") return deepFreeze({ kind: "blocked", reason: "stale_draft" })

  const orderedSelections = [...draft.selections].sort(compareSelections)
  const expectedKeys = new Set(orderedSelections.map(contextSelectionKey))
  const artifactByKey = new Map<string, MaterializedContextArtifact>()

  for (const artifact of artifacts) {
    if (artifactByKey.has(artifact.selectionKey)) {
      return deepFreeze({
        kind: "blocked",
        reason: "duplicate_artifact",
        selectionKey: artifact.selectionKey,
      })
    }
    if (!expectedKeys.has(artifact.selectionKey)) {
      return deepFreeze({
        kind: "blocked",
        reason: "unexpected_artifact",
        selectionKey: artifact.selectionKey,
      })
    }
    artifactByKey.set(artifact.selectionKey, artifact)
  }

  const materialized: Array<{ selection: ContextSelection; artifact: MaterializedContextArtifact }> = []
  for (const selection of orderedSelections) {
    const selectionKey = contextSelectionKey(selection)
    const artifact = artifactByKey.get(selectionKey)
    if (!artifact) {
      return deepFreeze({ kind: "blocked", reason: "missing_artifact", selectionKey })
    }
    if (!sameSourceReference(selection.source, artifact.source)) {
      return deepFreeze({ kind: "blocked", reason: "source_fence_mismatch", selectionKey })
    }
    if (utf8Bytes(artifact.content) !== artifact.source.bytes) {
      return deepFreeze({ kind: "blocked", reason: "artifact_size_mismatch", selectionKey })
    }
    materialized.push({ selection, artifact })
  }

  const unredactedPayload = serializeCandidate(draft, materialized)
  let redaction: ReturnType<SecretRedactor["redact"]>
  try {
    redaction = redactor.redact(unredactedPayload)
  } catch {
    return deepFreeze({ kind: "blocked", reason: "redaction_failed" })
  }
  if (
    typeof redaction?.text !== "string" ||
    !isNonnegativeInteger(redaction.count)
  ) {
    return deepFreeze({ kind: "blocked", reason: "redaction_failed" })
  }

  const bytes = utf8Bytes(redaction.text)
  const packEstimate = estimateTokens(bytes)
  const candidate: ContextPackReviewCandidate = {
    revision: draft.revision,
    manifest: draftToManifest(draft),
    payload: redaction.text,
    bytes,
    packEstimate,
    redactionCount: redaction.count,
    sourceFences: materialized.map(({ selection }) => sourceFence(selection)),
    verdict: packEstimate <= draft.budget.limit
      ? { kind: "ready" }
      : { kind: "blocked", reason: "over_budget" },
  }

  return deepFreeze({ kind: "assembled", candidate })
}

/** Seal only the exact current reviewed bytes after a fresh source-fence recheck. */
export function sealCandidate(input: {
  readonly draft: DraftContextPack
  readonly candidate: ContextPackReviewCandidate
  readonly currentSourceFences: readonly ContextPackSourceFence[]
  readonly sealedAt: number
}): ContextPackSealResult {
  const validation = validateDraft(input.draft)
  if (validation.kind === "invalid" || input.draft.stale.kind === "stale") {
    return deepFreeze({ kind: "blocked", reason: "invalid_draft" })
  }
  if (
    input.candidate.revision !== input.draft.revision ||
    input.candidate.manifest.revision !== input.draft.revision ||
    canonicalJson(input.candidate.manifest) !== canonicalJson(draftToManifest(input.draft))
  ) {
    return deepFreeze({ kind: "blocked", reason: "candidate_revision_mismatch" })
  }
  if (input.candidate.verdict.kind !== "ready") {
    return deepFreeze({ kind: "blocked", reason: "candidate_blocked" })
  }
  if (
    utf8Bytes(input.candidate.payload) !== input.candidate.bytes ||
    estimateTokens(input.candidate.bytes) !== input.candidate.packEstimate ||
    !isNonnegativeInteger(input.candidate.redactionCount)
  ) {
    return deepFreeze({ kind: "blocked", reason: "candidate_payload_mismatch" })
  }
  if (!Number.isFinite(input.sealedAt) || input.sealedAt < 0) {
    return deepFreeze({ kind: "blocked", reason: "invalid_sealed_at" })
  }

  const expectedFences = [...input.candidate.sourceFences].sort(compareSourceFences)
  const currentFences = [...input.currentSourceFences].sort(compareSourceFences)
  const draftFences = [...input.draft.selections]
    .sort(compareSelections)
    .map(sourceFence)
    .sort(compareSourceFences)
  if (
    !sourceFencesAreValid(expectedFences) ||
    !sourceFencesAreValid(currentFences) ||
    canonicalSourceFences(expectedFences) !== canonicalSourceFences(draftFences) ||
    canonicalSourceFences(expectedFences) !== canonicalSourceFences(currentFences)
  ) {
    return deepFreeze({ kind: "blocked", reason: "source_fence_mismatch" })
  }

  const sealed: SealedContextPack = {
    revision: input.candidate.revision,
    manifest: input.candidate.manifest,
    payload: input.candidate.payload,
    bytes: input.candidate.bytes,
    packEstimate: input.candidate.packEstimate,
    redactionCount: input.candidate.redactionCount,
    sourceFences: expectedFences,
    sealedAt: input.sealedAt,
  }
  return deepFreeze({ kind: "sealed", sealed })
}

/** Shared fail-closed recipient decision; it never changes or partially accepts a pack. */
export function assessRecipientFit(
  sealed: DurableSealedContextPack,
  evidence: RecipientFitEvidence,
): RecipientFit {
  if (evidence.kind === "missing") {
    return deepFreeze({ kind: "unavailable", reason: "missing_evidence" })
  }
  if (evidence.kind === "stale") {
    return deepFreeze({ kind: "unavailable", reason: "stale_evidence" })
  }
  if (
    !isNonnegativeInteger(evidence.sealedRevision) ||
    !isNonnegativeInteger(evidence.payloadBytes) ||
    !isNonnegativeInteger(evidence.exactCount) ||
    !isNonnegativeInteger(evidence.capacity) ||
    !isNonnegativeInteger(evidence.used) ||
    !isNonnegativeInteger(evidence.reserve) ||
    !isNonblankString(evidence.counterVersion) ||
    !isNonblankString(evidence.evidenceVersion)
  ) {
    return deepFreeze({ kind: "unavailable", reason: "invalid_evidence" })
  }
  if (
    evidence.sealedRevision !== sealed.revision ||
    evidence.payloadBytes !== sealed.bytes ||
    utf8Bytes(sealed.payload) !== sealed.bytes
  ) {
    return deepFreeze({ kind: "unavailable", reason: "payload_mismatch" })
  }

  const committed = evidence.used + evidence.reserve + evidence.exactCount
  if (!Number.isSafeInteger(committed)) {
    return deepFreeze({ kind: "unavailable", reason: "invalid_evidence" })
  }

  const remaining = evidence.capacity - committed
  return remaining >= 0
    ? deepFreeze({ kind: "fit", exactCount: evidence.exactCount, remaining })
    : deepFreeze({ kind: "insufficient", exactCount: evidence.exactCount, remaining })
}

function emptyContextBrief(): ContextBrief {
  return {
    architecture: "",
    selectedContext: "",
    relationships: "",
    ambiguities: "",
    budgetOmissions: "",
  }
}

function mutateDraft(
  draft: DraftContextPack,
  mutation: ContextPackMutation,
): { readonly kind: "candidate"; readonly draft: DraftContextPack } | Extract<ContextPackMutationResult, { kind: "invalid" }> {
  const revision = draft.revision + 1
  switch (mutation.kind) {
    case "set_instructions":
      return {
        kind: "candidate",
        draft: { ...draft, revision, instructions: { ...mutation.instructions } },
      }
    case "set_budget":
      return {
        kind: "candidate",
        draft: { ...draft, revision, budget: { unit: "estimated_tokens", limit: mutation.limit } },
      }
    case "set_brief_section":
      if (!(CONTEXT_BRIEF_SECTION_KEYS as readonly string[]).includes(mutation.section)) {
        return invalidMutation([{ code: "invalid_brief" }])
      }
      return {
        kind: "candidate",
        draft: {
          ...draft,
          revision,
          brief: { ...draft.brief, [mutation.section]: mutation.text },
        },
      }
    case "upsert_selection": {
      const issues: ContextPackValidationIssue[] = []
      validateSelection(mutation.selection, issues, 0)
      if (issues.length > 0) return invalidMutation(issues)
      const key = contextSelectionKey(mutation.selection)
      const existing = draft.selections.findIndex((selection) => contextSelectionKey(selection) === key)
      const selections = [...draft.selections]
      if (existing === -1) selections.push(cloneSelection(mutation.selection))
      else selections[existing] = cloneSelection(mutation.selection)
      return {
        kind: "candidate",
        draft: { ...draft, revision, selections, stale: { kind: "needs_revalidation" } },
      }
    }
    case "remove_selection": {
      const selections = draft.selections.filter(
        (selection) => contextSelectionKey(selection) !== mutation.selectionKey,
      )
      if (selections.length === draft.selections.length) {
        return invalidMutation([{ code: "invalid_selection" }])
      }
      return {
        kind: "candidate",
        draft: { ...draft, revision, selections, stale: { kind: "needs_revalidation" } },
      }
    }
  }
}

function validateInstructions(value: unknown, issues: ContextPackValidationIssue[]): void {
  if (!hasExactKeys(value, ["original", "mode", "discovered"])) {
    issues.push({ code: "invalid_instructions" })
    return
  }
  if (typeof value.original !== "string" || value.original.trim() === "") {
    issues.push({ code: "invalid_instructions" })
  }
  if (value.mode !== "preserve" && value.mode !== "augment" && value.mode !== "rewrite") {
    issues.push({ code: "invalid_instruction_mode" })
    return
  }
  if (typeof value.discovered !== "string") {
    issues.push({ code: "invalid_discovered_instructions" })
    return
  }
  if (value.mode === "preserve" && value.discovered !== "") {
    issues.push({ code: "invalid_discovered_instructions" })
  }
  if (value.mode === "rewrite" && value.discovered.trim() === "") {
    issues.push({ code: "invalid_discovered_instructions" })
  }
}

function validateBudget(value: unknown, issues: ContextPackValidationIssue[]): void {
  if (
    !hasExactKeys(value, ["unit", "limit"]) ||
    value.unit !== "estimated_tokens" ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) <= 0
  ) {
    issues.push({ code: "invalid_budget" })
  }
}

function validateBrief(value: unknown, issues: ContextPackValidationIssue[]): void {
  if (!hasExactKeys(value, [...CONTEXT_BRIEF_SECTION_KEYS])) {
    issues.push({ code: "invalid_brief" })
    return
  }
  if (CONTEXT_BRIEF_SECTION_KEYS.some((key) => typeof value[key] !== "string")) {
    issues.push({ code: "invalid_brief" })
  }
}

function validateStaleState(value: unknown, issues: ContextPackValidationIssue[]): void {
  if (!hasRecord(value) || typeof value.kind !== "string") {
    issues.push({ code: "invalid_stale_state" })
    return
  }
  if (
    (value.kind === "fresh" || value.kind === "needs_revalidation") &&
    hasExactKeys(value, ["kind"])
  ) return
  if (
    value.kind === "stale" &&
    hasExactKeys(value, ["kind", "reason"]) &&
    [
      "source_changed",
      "source_missing",
      "outside_workspace",
      "ineligible_source",
      "oversized_source",
    ].includes(value.reason as string)
  ) return
  issues.push({ code: "invalid_stale_state" })
}

function validateSelection(
  value: unknown,
  issues: ContextPackValidationIssue[],
  selectionIndex: number,
): void {
  if (!hasRecord(value) || typeof value.kind !== "string") {
    issues.push({ code: "invalid_selection", selectionIndex })
    return
  }
  const commonKeys = ["kind", "path", "source", "rationale", "relationship"]
  if (value.kind === "full_file") {
    if (!hasExactKeys(value, commonKeys)) issues.push({ code: "unsupported_fields", selectionIndex })
  } else if (value.kind === "file_slice") {
    if (!hasExactKeys(value, [...commonKeys, "range"])) {
      issues.push({ code: "unsupported_fields", selectionIndex })
    }
    if (
      !hasExactKeys(value.range, ["startLine", "endLine"]) ||
      !isPositiveInteger(value.range.startLine) ||
      !isPositiveInteger(value.range.endLine) ||
      value.range.startLine > value.range.endLine
    ) {
      issues.push({ code: "invalid_slice_range", selectionIndex })
    }
  } else if (value.kind === "diff") {
    if (!hasExactKeys(value, [...commonKeys, "scope"])) {
      issues.push({ code: "unsupported_fields", selectionIndex })
    }
    if (!(DIFF_SCOPES as readonly unknown[]).includes(value.scope)) {
      issues.push({ code: "invalid_diff_scope", selectionIndex })
    }
  } else {
    issues.push({ code: "invalid_selection", selectionIndex })
    return
  }

  if (!isValidRelativePath(value.path)) issues.push({ code: "invalid_path", selectionIndex })
  validateSource(value.source, issues, selectionIndex)
  if (!isNonblankString(value.rationale)) issues.push({ code: "invalid_rationale", selectionIndex })
  if (!isNonblankString(value.relationship)) issues.push({ code: "invalid_relationship", selectionIndex })
}

function validateSource(
  value: unknown,
  issues: ContextPackValidationIssue[],
  selectionIndex: number,
): void {
  if (!hasExactKeys(value, ["identity", "digest", "bytes"])) {
    issues.push({ code: "invalid_source_identity", selectionIndex })
    return
  }
  if (!isNonblankString(value.identity)) issues.push({ code: "invalid_source_identity", selectionIndex })
  if (typeof value.digest !== "string" || !SHA256_DIGEST.test(value.digest)) {
    issues.push({ code: "invalid_source_digest", selectionIndex })
  }
  if (!isNonnegativeInteger(value.bytes)) issues.push({ code: "invalid_source_bytes", selectionIndex })
}

function serializeCandidate(
  draft: DraftContextPack,
  materialized: readonly { selection: ContextSelection; artifact: MaterializedContextArtifact }[],
): string {
  const lines = [
    "# Context Pack",
    "",
    "## Task Instructions",
    "",
    `Mode: ${draft.instructions.mode}`,
    "",
    effectiveInstructions(draft.instructions),
    "",
    "## Context Brief",
    "",
  ]

  for (const section of CONTEXT_BRIEF_SECTION_KEYS) {
    lines.push(`### ${briefLabel(section)}`, "", draft.brief[section], "")
  }
  lines.push("## Selected Material", "")

  for (const [index, { selection, artifact }] of materialized.entries()) {
    lines.push(
      `### Selection ${index + 1}: ${selection.kind}`,
      "",
      `Path: ${JSON.stringify(selection.path)}`,
      `Source identity: ${JSON.stringify(selection.source.identity)}`,
      `Source digest: ${selection.source.digest}`,
      `Source bytes: ${selection.source.bytes}`,
      `Rationale: ${JSON.stringify(selection.rationale)}`,
      `Relationship: ${JSON.stringify(selection.relationship)}`,
    )
    if (selection.kind === "file_slice") {
      lines.push(`Lines: ${selection.range.startLine}-${selection.range.endLine}`)
    } else if (selection.kind === "diff") {
      lines.push(`Diff scope: ${selection.scope}`)
    }
    const fence = codeFenceFor(artifact.content)
    lines.push("", `${fence}${selection.kind === "diff" ? "diff" : "text"}`, artifact.content, fence, "")
  }

  return `${lines.join("\n").replace(/\n+$/u, "")}\n`
}

function effectiveInstructions(instructions: ContextPackInstructions): string {
  if (instructions.mode === "preserve") return instructions.original
  if (instructions.mode === "rewrite") return instructions.discovered
  return instructions.discovered === ""
    ? instructions.original
    : `${instructions.original}\n\n${instructions.discovered}`
}

function briefLabel(section: ContextBriefSection): string {
  switch (section) {
    case "architecture": return "Architecture"
    case "selectedContext": return "Selected Context"
    case "relationships": return "Relationships"
    case "ambiguities": return "Ambiguities"
    case "budgetOmissions": return "Budget Omissions"
  }
}

function codeFenceFor(content: string): string {
  let longest = 0
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return "`".repeat(Math.max(3, longest + 1))
}

function compareSelections(left: ContextSelection, right: ContextSelection): number {
  const rank = { full_file: 0, file_slice: 1, diff: 2 } as const
  return rank[left.kind] - rank[right.kind] || compareText(contextSelectionKey(left), contextSelectionKey(right))
}

function compareSourceFences(left: ContextPackSourceFence, right: ContextPackSourceFence): number {
  return compareText(left.selectionKey, right.selectionKey) ||
    compareText(left.identity, right.identity) ||
    compareText(left.digest, right.digest) ||
    left.bytes - right.bytes
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sourceFence(selection: ContextSelection): ContextPackSourceFence {
  return {
    selectionKey: contextSelectionKey(selection),
    ...selection.source,
  }
}

function sourceFencesAreValid(fences: readonly ContextPackSourceFence[]): boolean {
  const seen = new Set<string>()
  return fences.every((fence) => {
    if (
      !hasExactKeys(fence, ["selectionKey", "identity", "digest", "bytes"]) ||
      !isNonblankString(fence.selectionKey) ||
      !isNonblankString(fence.identity) ||
      typeof fence.digest !== "string" ||
      !SHA256_DIGEST.test(fence.digest) ||
      !isNonnegativeInteger(fence.bytes) ||
      seen.has(fence.selectionKey)
    ) return false
    seen.add(fence.selectionKey)
    return true
  })
}

function sameSourceReference(left: ContextPackSourceReference, right: ContextPackSourceReference): boolean {
  return left.identity === right.identity && left.digest === right.digest && left.bytes === right.bytes
}

function cloneDraft(draft: DraftContextPack): DraftContextPack {
  return {
    revision: draft.revision,
    instructions: { ...draft.instructions },
    budget: { ...draft.budget },
    brief: { ...draft.brief },
    selections: draft.selections.map(cloneSelection),
    stale: { ...draft.stale },
  }
}

function cloneSelection(selection: ContextSelection): ContextSelection {
  switch (selection.kind) {
    case "full_file":
      return { ...selection, source: { ...selection.source } }
    case "file_slice":
      return { ...selection, source: { ...selection.source }, range: { ...selection.range } }
    case "diff":
      return { ...selection, source: { ...selection.source } }
  }
}

function invalidMutation(
  issues: readonly ContextPackValidationIssue[],
): Extract<ContextPackMutationResult, { kind: "invalid" }> {
  return deepFreeze({ kind: "invalid", issues })
}

function invalidRestore(issues: readonly ContextPackValidationIssue[]): ContextPackRestoreResult {
  return deepFreeze({ kind: "invalid", issues })
}

function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4)
}

function utf8Bytes(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value)
}

function canonicalSourceFences(fences: readonly ContextPackSourceFence[]): string {
  return JSON.stringify(fences.map((fence) => [
    fence.selectionKey,
    fence.identity,
    fence.digest,
    fence.bytes,
  ]))
}

function isValidRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value === "" || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    return false
  }
  const segments = value.split("/")
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is Record<K, unknown> {
  if (!hasRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => (keys as readonly string[]).includes(key))
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key])
  }
  return Object.freeze(value)
}
