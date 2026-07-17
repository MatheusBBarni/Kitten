import { describe, expect, it } from "bun:test"

import { createSecretRedactor, type SecretRedactor } from "./secretRedactor.ts"
import {
  DEFAULT_CONTEXT_PACK_BUDGET,
  applyBuilderMutation,
  applyOperatorMutation,
  assembleCandidate,
  assessRecipientFit,
  contextSelectionKey,
  createDraft,
  draftToManifest,
  restoreManifest,
  sealCandidate,
  startFreshFromSealed,
  validateDraft,
} from "./contextPack.ts"
import type {
  ContextDiffSelection,
  ContextFileSliceSelection,
  ContextFullFileSelection,
  ContextPackMutation,
  ContextPackReviewCandidate,
  ContextPackSourceReference,
  ContextSelection,
  DraftContextPack,
  MaterializedContextArtifact,
  RecipientFitEvidence,
  SealedContextPack,
} from "./types.ts"

// Suite: Context Pack pure lifecycle and assembly
// Invariant: invalid, stale, or partial inputs cannot become sealed bytes, while equivalent valid inputs do so deterministically.
// Boundary IN: protocol-free values, mutations, supplied artifacts/redaction/evidence, candidate assembly, and sealing.
// Boundary OUT: workspace I/O, digest calculation, AppStore, persistence, controller/bridge authority, ACP, UI, and telemetry.

const encoder = new TextEncoder()
const DIGEST_A = "a".repeat(64)
const DIGEST_B = "b".repeat(64)
const DIGEST_C = "c".repeat(64)
const FAKE_SECRET = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD"

function source(identity: string, content: string, digest = DIGEST_A): ContextPackSourceReference {
  return { identity, digest, bytes: encoder.encode(content).byteLength }
}

function fullFile(path: string, content: string, digest = DIGEST_A): ContextFullFileSelection {
  return {
    kind: "full_file",
    path,
    source: source(`file:${path}`, content, digest),
    rationale: `Needed from ${path}`,
    relationship: "Defines a task dependency",
  }
}

function fileSlice(path: string, content: string, digest = DIGEST_B): ContextFileSliceSelection {
  return {
    kind: "file_slice",
    path,
    range: { startLine: 2, endLine: 4 },
    source: source(`slice:${path}:2-4`, content, digest),
    rationale: `Relevant lines from ${path}`,
    relationship: "Calls the selected implementation",
  }
}

function diff(path: string, content: string, digest = DIGEST_C): ContextDiffSelection {
  return {
    kind: "diff",
    path,
    scope: "unstaged",
    source: source(`diff:unstaged:${path}`, content, digest),
    rationale: `Current changes in ${path}`,
    relationship: "Shows the behavior under review",
  }
}

function newDraft(options: Parameters<typeof createDraft>[1] = {}): DraftContextPack {
  const result = createDraft("Implement the requested lifecycle.", options)
  if (result.kind !== "created") throw new Error("test fixture draft must be valid")
  return result.draft
}

function apply(draft: DraftContextPack, mutation: ContextPackMutation): DraftContextPack {
  const result = applyOperatorMutation(draft, mutation)
  if (result.kind !== "applied") throw new Error(`test fixture mutation failed: ${result.kind}`)
  return result.draft
}

function withSelections(
  selections: readonly ContextSelection[],
  options: Parameters<typeof createDraft>[1] = {},
): DraftContextPack {
  return selections.reduce(
    (draft, selection) => apply(draft, { kind: "upsert_selection", selection }),
    newDraft(options),
  )
}

function artifact(selection: ContextSelection, content: string): MaterializedContextArtifact {
  return {
    selectionKey: contextSelectionKey(selection),
    source: selection.source,
    content,
  }
}

function assembled(
  draft: DraftContextPack,
  artifacts: readonly MaterializedContextArtifact[],
): ContextPackReviewCandidate {
  const result = assembleCandidate(draft, artifacts, createSecretRedactor())
  if (result.kind !== "assembled") throw new Error(`test fixture assembly failed: ${result.reason}`)
  return result.candidate
}

function seal(
  draft: DraftContextPack,
  candidate: ContextPackReviewCandidate,
  sealedAt = 123_456,
): SealedContextPack {
  const result = sealCandidate({
    draft,
    candidate,
    currentSourceFences: candidate.sourceFences.map((fence) => ({
      identity: fence.identity,
      digest: fence.digest,
      bytes: fence.bytes,
      selectionKey: fence.selectionKey,
    })).reverse(),
    sealedAt,
  })
  if (result.kind !== "sealed") throw new Error(`test fixture seal failed: ${result.reason}`)
  return result.sealed
}

describe("draft contracts", () => {
  it("creates the 80k default budget and exactly the five fixed brief sections", () => {
    const draft = newDraft()

    expect(draft.budget).toEqual({ unit: "estimated_tokens", limit: DEFAULT_CONTEXT_PACK_BUDGET })
    expect(Object.keys(draft.brief)).toEqual([
      "architecture",
      "selectedContext",
      "relationships",
      "ambiguities",
      "budgetOmissions",
    ])
    expect(draft.instructions.mode).toBe("augment")
    expect(draft.revision).toBe(0)
    expect(draft.stale).toEqual({ kind: "fresh" })
  })

  it("preserves original instructions byte-for-byte in preserve mode", () => {
    const original = "  Keep spacing.\nAnd the final newline.\n"
    const result = createDraft(original, { mode: "preserve" })
    expect(result.kind).toBe("created")
    if (result.kind === "created") expect(result.draft.instructions.original).toBe(original)
  })

  it("rejects invalid create inputs without throwing or producing a draft", () => {
    expect(createDraft("   ")).toEqual({
      kind: "invalid",
      issues: [{ code: "invalid_instructions" }],
    })
    expect(createDraft("task", { mode: "preserve", discovered: "builder text" })).toEqual({
      kind: "invalid",
      issues: [{ code: "invalid_discovered_instructions" }],
    })
    expect(createDraft("task", { budgetLimit: 0 })).toEqual({
      kind: "invalid",
      issues: [{ code: "invalid_budget" }],
    })
  })
})

describe("selection validation", () => {
  const validContent = "export const value = 1\n"

  it.each([
    {
      name: "raw content attached to a full file",
      selection: { ...fullFile("src/a.ts", validContent), content: validContent } as ContextSelection,
      code: "unsupported_fields",
    },
    {
      name: "an escaping path",
      selection: { ...fullFile("src/a.ts", validContent), path: "../secret.txt" },
      code: "invalid_path",
    },
    {
      name: "a malformed digest",
      selection: {
        ...fullFile("src/a.ts", validContent),
        source: { ...fullFile("src/a.ts", validContent).source, digest: "not-sha256" },
      },
      code: "invalid_source_digest",
    },
    {
      name: "an inverted slice",
      selection: { ...fileSlice("src/a.ts", validContent), range: { startLine: 4, endLine: 2 } },
      code: "invalid_slice_range",
    },
    {
      name: "an unknown diff scope",
      selection: { ...diff("src/a.ts", validContent), scope: "working-tree" } as unknown as ContextSelection,
      code: "invalid_diff_scope",
    },
  ])("rejects $name as a typed invalid mutation", ({ selection, code }) => {
    const draft = newDraft()
    const result = applyOperatorMutation(draft, { kind: "upsert_selection", selection })

    expect(result.kind).toBe("invalid")
    if (result.kind === "invalid") expect(result.issues.map((issue) => issue.code)).toContain(code)
    expect(draft.selections).toEqual([])
    expect(draft.revision).toBe(0)
  })

  it("keeps only full-file, slice, and diff metadata in the draft", () => {
    const full = fullFile("src/full.ts", validContent)
    const slice = fileSlice("src/slice.ts", validContent)
    const currentDiff = diff("src/diff.ts", validContent)
    const draft = withSelections([full, slice, currentDiff])

    expect(draft.selections.map((selection) => selection.kind)).toEqual([
      "full_file",
      "file_slice",
      "diff",
    ])
    expect(JSON.stringify(draft)).not.toContain(validContent)
    expect(validateDraft(draft)).toEqual({ kind: "valid" })
  })

  it("rejects duplicate selection identity", () => {
    const selection = fullFile("src/a.ts", validContent)
    const draft = {
      ...newDraft(),
      selections: [selection, { ...selection }],
      stale: { kind: "needs_revalidation" } as const,
    }

    expect(validateDraft(draft)).toEqual({
      kind: "invalid",
      issues: [{ code: "duplicate_selection", selectionIndex: 1 }],
    })
  })
})

describe("revision-fenced mutations", () => {
  it("lets an operator edit win over a stale builder mutation", () => {
    const original = newDraft()
    const operator = applyOperatorMutation(original, {
      kind: "set_brief_section",
      section: "architecture",
      text: "Operator-approved architecture.",
    })
    if (operator.kind !== "applied") throw new Error("operator fixture must apply")

    const staleBuilder = applyBuilderMutation(operator.draft, {
      readRevision: original.revision,
      mutation: {
        kind: "set_brief_section",
        section: "architecture",
        text: "Stale builder architecture.",
      },
    })

    expect(staleBuilder).toEqual({ kind: "stale", readRevision: 0, currentRevision: 1 })
    expect(operator.draft.brief.architecture).toBe("Operator-approved architecture.")
    expect(operator.draft.revision).toBe(1)
  })

  it("accepts a scoped builder mutation against the exact revision and preserves operator authority", () => {
    const draft = newDraft()
    const result = applyBuilderMutation(draft, {
      readRevision: draft.revision,
      mutation: { kind: "set_discovered_instructions", discovered: "Observed call relationships." },
    })

    expect(result.kind).toBe("applied")
    if (result.kind === "applied") {
      expect(result.draft.revision).toBe(1)
      expect(result.draft.instructions.original).toBe(draft.instructions.original)
      expect(result.draft.instructions.discovered).toBe("Observed call relationships.")
      expect(result.draft.budget).toEqual(draft.budget)
    }
  })

  it("fails closed when an untrusted builder request tries an operator-only mutation", () => {
    const draft = newDraft()
    const input = {
      readRevision: draft.revision,
      mutation: { kind: "set_budget", limit: 1 },
    } as unknown as Parameters<typeof applyBuilderMutation>[1]

    expect(applyBuilderMutation(draft, input)).toEqual({
      kind: "invalid",
      issues: [{ code: "unauthorized_mutation" }],
    })
    expect(draft.budget.limit).toBe(DEFAULT_CONTEXT_PACK_BUDGET)
  })

  it("does not mutate the prior draft when removing a selection", () => {
    const content = "export const a = 1\n"
    const selection = fullFile("src/a.ts", content)
    const draft = withSelections([selection])
    const result = applyOperatorMutation(draft, {
      kind: "remove_selection",
      selectionKey: contextSelectionKey(selection),
    })

    expect(result.kind).toBe("applied")
    if (result.kind === "applied") expect(result.draft.selections).toEqual([])
    expect(draft.selections).toHaveLength(1)
  })
})

describe("deterministic candidate assembly", () => {
  const fullContent = `export const token = "${FAKE_SECRET}"\n`
  const sliceContent = "export function call() {\n  return token\n}\n"
  const diffContent = "@@ -1 +1 @@\n-old\n+new\n"
  const full = fullFile("src/z-full.ts", fullContent)
  const slice = fileSlice("src/a-slice.ts", sliceContent)
  const currentDiff = diff("src/m-diff.ts", diffContent)

  it("orders selections, counts redacted bytes, and emits stable source fences", () => {
    const draft = withSelections([currentDiff, full, slice])
    const candidate = assembled(draft, [artifact(slice, sliceContent), artifact(currentDiff, diffContent), artifact(full, fullContent)])

    const fullAt = candidate.payload.indexOf('Path: "src/z-full.ts"')
    const sliceAt = candidate.payload.indexOf('Path: "src/a-slice.ts"')
    const diffAt = candidate.payload.indexOf('Path: "src/m-diff.ts"')
    expect(fullAt).toBeGreaterThan(-1)
    expect(sliceAt).toBeGreaterThan(fullAt)
    expect(diffAt).toBeGreaterThan(sliceAt)
    expect(candidate.payload).not.toContain(FAKE_SECRET)
    expect(candidate.redactionCount).toBe(1)
    expect(candidate.bytes).toBe(encoder.encode(candidate.payload).byteLength)
    expect(candidate.packEstimate).toBe(Math.ceil(candidate.bytes / 4))
    expect(candidate.sourceFences.map((fence) => fence.selectionKey)).toEqual([
      contextSelectionKey(full),
      contextSelectionKey(slice),
      contextSelectionKey(currentDiff),
    ])
    expect(candidate.verdict).toEqual({ kind: "ready" })
  })

  it("uses a collision-safe deterministic fence when source content contains backticks", () => {
    const content = "const markdown = ```nested```\n"
    const selection = fullFile("src/fence.ts", content)
    const candidate = assembled(withSelections([selection]), [artifact(selection, content)])

    expect(candidate.payload).toContain("````text\n")
    expect(candidate.payload).toContain("\n````\n")
  })

  it("returns no partial candidate for missing, extra, duplicate, changed, or mis-sized artifacts", () => {
    const draft = withSelections([full])
    const valid = artifact(full, fullContent)
    const extraSelection = fullFile("src/extra.ts", "extra\n")
    const cases = [
      assembleCandidate(draft, [], createSecretRedactor()),
      assembleCandidate(draft, [valid, artifact(extraSelection, "extra\n")], createSecretRedactor()),
      assembleCandidate(draft, [valid, valid], createSecretRedactor()),
      assembleCandidate(draft, [{ ...valid, source: { ...valid.source, digest: DIGEST_B } }], createSecretRedactor()),
      assembleCandidate(draft, [{ ...valid, content: `${fullContent}extra` }], createSecretRedactor()),
    ]

    expect(cases.map((result) => result.kind)).toEqual([
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "blocked",
    ])
    expect(cases.map((result) => result.kind === "blocked" ? result.reason : "assembled")).toEqual([
      "missing_artifact",
      "unexpected_artifact",
      "duplicate_artifact",
      "source_fence_mismatch",
      "artifact_size_mismatch",
    ])
    for (const result of cases) expect(result).not.toHaveProperty("candidate")
  })

  it("blocks instead of retaining unredacted bytes when redaction fails", () => {
    const draft = withSelections([full])
    const throwingRedactor: SecretRedactor = {
      redact(): never {
        throw new Error("redactor unavailable")
      },
    }

    expect(assembleCandidate(draft, [artifact(full, fullContent)], throwingRedactor)).toEqual({
      kind: "blocked",
      reason: "redaction_failed",
    })
  })

  it("retains a complete over-budget review candidate but blocks sealing", () => {
    const draft = withSelections([full], { budgetLimit: 1 })
    const candidate = assembled(draft, [artifact(full, fullContent)])

    expect(candidate.verdict).toEqual({ kind: "blocked", reason: "over_budget" })
    expect(candidate.payload.length).toBeGreaterThan(0)
    expect(sealCandidate({
      draft,
      candidate,
      currentSourceFences: candidate.sourceFences,
      sealedAt: 1,
    })).toEqual({ kind: "blocked", reason: "candidate_blocked" })
  })
})

describe("sealing, refinement, and restoration", () => {
  const content = "export const stable = true\n"
  const selection = fullFile("src/stable.ts", content)

  it("seals exact immutable bytes and rejects changed source fences", () => {
    const draft = withSelections([selection])
    const candidate = assembled(draft, [artifact(selection, content)])
    const changedFences = candidate.sourceFences.map((fence) => ({ ...fence, digest: DIGEST_B }))

    expect(sealCandidate({ draft, candidate, currentSourceFences: changedFences, sealedAt: 1 })).toEqual({
      kind: "blocked",
      reason: "source_fence_mismatch",
    })

    const sealed = seal(draft, candidate)
    expect(sealed.payload).toBe(candidate.payload)
    expect(sealed.bytes).toBe(candidate.bytes)
    expect(Object.isFrozen(sealed)).toBe(true)
    expect(Object.isFrozen(sealed.manifest)).toBe(true)
    expect(Object.isFrozen(sealed.sourceFences)).toBe(true)
    expect(() => {
      ;(sealed as { payload: string }).payload = "changed"
    }).toThrow()
  })

  it("rejects a candidate after a newer operator revision", () => {
    const draft = withSelections([selection])
    const candidate = assembled(draft, [artifact(selection, content)])
    const edited = apply(draft, {
      kind: "set_brief_section",
      section: "ambiguities",
      text: "A newer operator decision.",
    })

    expect(sealCandidate({
      draft: edited,
      candidate,
      currentSourceFences: candidate.sourceFences,
      sealedAt: 1,
    })).toEqual({ kind: "blocked", reason: "candidate_revision_mismatch" })
  })

  it("creates a distinct revalidation-required draft without changing the sealed pack", () => {
    const draft = withSelections([selection])
    const sealed = seal(draft, assembled(draft, [artifact(selection, content)]))
    const before = sealed.payload
    const refined = startFreshFromSealed(sealed)

    expect(refined.kind).toBe("created")
    if (refined.kind === "created") {
      expect(refined.draft).not.toBe(draft)
      expect(refined.draft.selections).not.toBe(sealed.manifest.selections)
      expect(refined.draft.selections).toEqual(sealed.manifest.selections)
      expect(refined.draft.revision).toBe(sealed.revision + 1)
      expect(refined.draft.stale).toEqual({ kind: "needs_revalidation" })
    }
    expect(sealed.payload).toBe(before)
  })

  it("restores only a strict metadata manifest and requires revalidation", () => {
    const manifest = draftToManifest(withSelections([selection]))
    const restored = restoreManifest(JSON.parse(JSON.stringify(manifest)))

    expect(restored.kind).toBe("restored")
    if (restored.kind === "restored") {
      expect(restored.draft.stale).toEqual({ kind: "needs_revalidation" })
      expect(restored.draft.selections).toEqual(manifest.selections)
      expect(Object.isFrozen(restored.draft)).toBe(true)
    }

    expect(restoreManifest({ ...manifest, rawSource: content })).toEqual({
      kind: "invalid",
      issues: [{ code: "unsupported_fields" }],
    })
  })
})

describe("recipient fit", () => {
  const content = "export const fit = true\n"
  const selection = fullFile("src/fit.ts", content)
  const draft = withSelections([selection])
  const sealed = seal(draft, assembled(draft, [artifact(selection, content)]))

  function current(overrides: Partial<Extract<RecipientFitEvidence, { kind: "current" }>> = {}): RecipientFitEvidence {
    return {
      kind: "current",
      sealedRevision: sealed.revision,
      payloadBytes: sealed.bytes,
      exactCount: 100,
      capacity: 1_000,
      used: 200,
      reserve: 100,
      counterVersion: "counter-v1",
      evidenceVersion: "evidence-v1",
      ...overrides,
    }
  }

  it("returns only typed unavailable outcomes for missing, stale, invalid, and mismatched evidence", () => {
    expect(assessRecipientFit(sealed, { kind: "missing" })).toEqual({
      kind: "unavailable",
      reason: "missing_evidence",
    })
    expect(assessRecipientFit(sealed, { kind: "stale" })).toEqual({
      kind: "unavailable",
      reason: "stale_evidence",
    })
    expect(assessRecipientFit(sealed, current({ counterVersion: "" }))).toEqual({
      kind: "unavailable",
      reason: "invalid_evidence",
    })
    expect(assessRecipientFit(sealed, current({ payloadBytes: sealed.bytes + 1 }))).toEqual({
      kind: "unavailable",
      reason: "payload_mismatch",
    })
    expect(
      assessRecipientFit(
        sealed,
        current({ exactCount: Number.MAX_SAFE_INTEGER, used: 1, reserve: 0 }),
      ),
    ).toEqual({
      kind: "unavailable",
      reason: "invalid_evidence",
    })
  })

  it("distinguishes exact fit from insufficient capacity without changing sealed bytes", () => {
    const before = sealed.payload

    expect(assessRecipientFit(sealed, current())).toEqual({
      kind: "fit",
      exactCount: 100,
      remaining: 600,
    })
    expect(assessRecipientFit(sealed, current({ exactCount: 800 }))).toEqual({
      kind: "insufficient",
      exactCount: 800,
      remaining: -100,
    })
    expect(sealed.payload).toBe(before)
  })
})

describe("integration: deterministic review-to-seal pipeline", () => {
  it("produces byte-identical reviewed and sealed payloads across equivalent runs", () => {
    const fullContent = "export const alpha = 1\n"
    const sliceContent = "export const beta = 2\n"
    const diffContent = "@@ -1 +1 @@\n-old\n+new\n"
    const selections = [
      fullFile("src/alpha.ts", fullContent),
      fileSlice("src/beta.ts", sliceContent),
      diff("src/gamma.ts", diffContent),
    ] as const
    const firstDraft = withSelections([selections[2], selections[0], selections[1]])
    const secondDraft = withSelections([selections[1], selections[2], selections[0]])
    const artifacts = [
      artifact(selections[0], fullContent),
      artifact(selections[1], sliceContent),
      artifact(selections[2], diffContent),
    ] as const

    const firstCandidate = assembled(firstDraft, [artifacts[2], artifacts[0], artifacts[1]])
    const secondCandidate = assembled(secondDraft, [artifacts[1], artifacts[2], artifacts[0]])
    const firstSealed = seal(firstDraft, firstCandidate, 10)
    const secondSealed = seal(secondDraft, secondCandidate, 20)

    expect(firstCandidate).toEqual(secondCandidate)
    expect(firstCandidate.payload).toBe(secondCandidate.payload)
    expect(firstCandidate.bytes).toBe(secondCandidate.bytes)
    expect(firstSealed.payload).toBe(secondSealed.payload)
    expect(firstSealed.bytes).toBe(secondSealed.bytes)
  })
})
