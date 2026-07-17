/** Selected-session Context Pack custody, review, and explicit action workspace. */

import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import type {
  ContextPackReviewCandidate,
  ContextPackSealedState,
  ContextSelection,
  DraftContextPackManifest,
  DraftContextPack,
  RecipientFit,
  SessionId,
} from "../core/types.ts"
import {
  selectContextPackBuild,
  selectContextPackDraft,
  selectContextPackReview,
  selectContextPackSealed,
  selectIsApprovalOpen,
  selectIsClarificationOpen,
  selectSessionUsage,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { CONTEXT_PACK_HINT, matchContextPackCommand } from "./keymap.ts"
import { ContextPackFileExplorer } from "./ContextPackFileExplorer.tsx"
import { usePalette } from "./theme.ts"

export const CONTEXT_PACK_TITLE = "Context Pack"
export const CONTEXT_PACK_SCROLLBOX_ID = "context-pack-details"
export const CONTEXT_PACK_EXACT_REVIEW_LABEL = "Exact review candidate"
export const CONTEXT_PACK_EXACT_SEALED_LABEL = "Exact sealed payload"
export const CONTEXT_PACK_EXPORT_DESTINATION_LABEL = "Export destination"

type ContextPackActionId = "build" | "review" | "seal" | "send" | "refine" | "export" | "files"
type ExportPhase = "idle" | "destination" | "overwrite"

interface ContextPackActionRow {
  readonly id: ContextPackActionId
  readonly label: string
  readonly enabled: boolean
  readonly reason: string | null
}

export interface ContextPackPanelProps {
  /** Exact session currently selected by the cockpit route. */
  sessionId: SessionId
  /** Return to the selected session conversation without changing pack custody. */
  onClose(): void
}

/** Key local interaction state by session so a switch cannot retain another session's notice or destination. */
export function ContextPackPanel({ sessionId, onClose }: ContextPackPanelProps): ReactNode {
  return <ContextPackPanelBody key={sessionId} sessionId={sessionId} onClose={onClose} />
}

function ContextPackPanelBody({ sessionId, onClose }: ContextPackPanelProps): ReactNode {
  const controller = useController()
  const palette = usePalette()
  const details = useRef<ScrollBoxRenderable | null>(null)
  const draftSelector = useMemo(() => selectContextPackDraft(sessionId), [sessionId])
  const reviewSelector = useMemo(() => selectContextPackReview(sessionId), [sessionId])
  const sealedSelector = useMemo(() => selectContextPackSealed(sessionId), [sessionId])
  const buildSelector = useMemo(() => selectContextPackBuild(sessionId), [sessionId])
  const usageSelector = useMemo(() => selectSessionUsage(sessionId), [sessionId])
  const draft = useAppSelector(draftSelector)
  const review = useAppSelector(reviewSelector)
  const sealed = useAppSelector(sealedSelector)
  const build = useAppSelector(buildSelector)
  const usage = useAppSelector(usageSelector)
  const approvalOpen = useAppSelector(selectIsApprovalOpen)
  const clarificationOpen = useAppSelector(selectIsClarificationOpen)
  const preempted = approvalOpen || clarificationOpen

  const buildChoice = useMemo(() => draft ? ({
    kind: "start_fresh" as const,
    original: draft.instructions.original,
    mode: draft.instructions.mode,
    discovered: draft.instructions.discovered,
    budgetLimit: draft.budget.limit,
  }) : null, [draft])
  const buildAvailability = useMemo(
    () => buildChoice
      ? controller.actions.contextBuildAvailability({ parentId: sessionId, draft: buildChoice })
      : ({ kind: "denied", reason: "draft_unavailable" } as const),
    [buildChoice, controller, sessionId],
  )
  const refinable = isLiveSealed(sealed)
  const refineAvailability = useMemo(
    () => refinable
      ? controller.actions.contextBuildAvailability({ parentId: sessionId, draft: { kind: "refine" } })
      : ({ kind: "denied", reason: "draft_unavailable" } as const),
    [controller, refinable, sessionId],
  )
  const fit = useMemo<RecipientFit | null>(
    () => sealed ? controller.actions.assessContextPackRecipientFit(sessionId) : null,
    [controller, sealed, sessionId, usage],
  )

  const [selectedAction, setSelectedAction] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<ContextPackActionId | null>(null)
  const [exportPhase, setExportPhase] = useState<ExportPhase>("idle")
  const [destination, setDestination] = useState("")
  const [fileExplorerActive, setFileExplorerActive] = useState(false)
  const pendingRef = useRef(false)

  const actions = useMemo<readonly ContextPackActionRow[]>(() => [
    {
      id: "build",
      label: "Build Context",
      enabled: draft !== null && build === null && buildAvailability.kind === "available",
      reason: draft === null
        ? "Draft unavailable"
        : build !== null
          ? "Context Build already active"
          : denialReason(buildAvailability),
    },
    {
      id: "review",
      label: "Review Context Pack",
      enabled: draft !== null && build === null,
      reason: draft === null ? "Draft unavailable" : build !== null ? "Context Build still active" : null,
    },
    {
      id: "seal",
      label: "Seal exact candidate",
      enabled: review?.verdict.kind === "ready",
      reason: review === null
        ? "Review candidate unavailable"
        : review.verdict.kind === "blocked"
          ? humanizeReason(review.verdict.reason)
          : null,
    },
    {
      id: "send",
      label: "Send Here",
      enabled: sealed !== null && fit?.kind === "fit",
      reason: sealed === null ? "Sealed pack unavailable" : fitReason(fit),
    },
    {
      id: "refine",
      label: "Refine sealed pack",
      enabled: refinable && build === null && refineAvailability.kind === "available",
      reason: sealed === null
        ? "Sealed pack unavailable"
        : !refinable
          ? "Restored pack must be reviewed before refinement"
          : build !== null
            ? "Context Build already active"
            : denialReason(refineAvailability),
    },
    {
      id: "export",
      label: "Export Markdown",
      enabled: sealed !== null,
      reason: sealed === null ? "Sealed pack unavailable" : null,
    },
    {
      id: "files",
      label: "File Explorer membership",
      enabled: draft !== null && draft.stale.kind !== "stale",
      reason: draft === null
        ? sealed === null ? "Draft unavailable" : "Sealed pack is immutable; refine it first"
        : draft.stale.kind === "stale" ? "Draft freshness requires attention" : null,
    },
  ], [build, buildAvailability, draft, fit, refinable, refineAvailability, review, sealed])

  const submitExport = useCallback(async (overwriteConfirmed: boolean): Promise<void> => {
    if (pendingRef.current || destination.trim().length === 0) {
      if (destination.trim().length === 0) setNotice("Blocked: export destination required")
      return
    }
    pendingRef.current = true
    setPendingAction("export")
    const result = await controller.actions.exportContextPack({
      sessionId,
      destination,
      writeConfirmed: true,
      overwriteConfirmed,
    })
    pendingRef.current = false
    setPendingAction(null)
    if (result.kind === "exported") {
      setExportPhase("idle")
      setNotice(`Exported: ${result.exportBytes} bytes`)
      return
    }
    if (result.reason === "overwrite_confirmation_required") {
      setExportPhase("overwrite")
      setNotice("Blocked: destination exists — Enter confirms overwrite; Esc cancels")
      return
    }
    setExportPhase("idle")
    setNotice(`Blocked: ${humanizeReason(result.reason)}`)
  }, [controller, destination, sessionId])

  const activate = useCallback(async (): Promise<void> => {
    if (pendingRef.current) return
    const action = actions[selectedAction]
    if (!action) return
    setNotice(null)
    if (!action.enabled) {
      setNotice(`Unavailable: ${action.reason ?? "action blocked"}`)
      return
    }
    if (action.id === "export") {
      setExportPhase("destination")
      return
    }
    if (action.id === "files") {
      setFileExplorerActive(true)
      setNotice("File Explorer focused")
      return
    }

    pendingRef.current = true
    setPendingAction(action.id)
    try {
      switch (action.id) {
        case "build": {
          if (!buildChoice) break
          const result = await controller.actions.startContextBuild({ parentId: sessionId, draft: buildChoice })
          setNotice(result.kind === "started"
            ? `Started: Context Build revision ${result.draftRevision}`
            : `Denied: ${humanizeReason(result.reason)}`)
          break
        }
        case "review": {
          const result = await controller.actions.reviewContextPack(sessionId)
          setNotice(result.kind === "reviewed"
            ? `Reviewed: revision ${result.candidate.revision}`
            : `Blocked: ${humanizeReason(result.reason)}`)
          break
        }
        case "seal": {
          if (!review) break
          const result = await controller.actions.sealContextPack(sessionId, review.revision)
          setNotice(result.kind === "sealed"
            ? `Sealed: revision ${result.sealed.revision}`
            : `Blocked: ${humanizeReason(result.reason)}`)
          break
        }
        case "send": {
          const result = await controller.actions.sendContextPackHere(sessionId)
          setNotice(result.kind === "sent"
            ? "Sent Here: exact sealed payload dispatched"
            : `Blocked: ${result.fit ? recipientFitLabel(result.fit) : humanizeReason(result.reason)}`)
          break
        }
        case "refine": {
          const result = await controller.actions.startContextBuild({ parentId: sessionId, draft: { kind: "refine" } })
          setNotice(result.kind === "started"
            ? `Started: refinement revision ${result.draftRevision}`
            : `Denied: ${humanizeReason(result.reason)}`)
          break
        }
      }
    } finally {
      pendingRef.current = false
      setPendingAction(null)
    }
  }, [actions, buildChoice, controller, review, selectedAction, sessionId])

  const onKey = useCallback((key: KeyEvent): void => {
    if (preempted) return
    if (fileExplorerActive) return
    if (exportPhase === "destination") {
      if (key.name === "escape" && !key.ctrl && !key.meta && !key.shift) {
        key.preventDefault()
        setExportPhase("idle")
        setNotice("Export cancelled")
      }
      return
    }
    if (exportPhase === "overwrite") {
      if (key.name === "escape" && !key.ctrl && !key.meta && !key.shift) {
        key.preventDefault()
        setExportPhase("idle")
        setNotice("Overwrite cancelled")
      } else if (["return", "kpenter"].includes(key.name) && !key.ctrl && !key.meta && !key.shift) {
        key.preventDefault()
        void submitExport(true)
      }
      return
    }

    const command = matchContextPackCommand(key)
    if (command === null) return
    key.preventDefault()
    switch (command) {
      case "prev-action":
        if (!pendingRef.current) setSelectedAction((current) => (current - 1 + actions.length) % actions.length)
        return
      case "next-action":
        if (!pendingRef.current) setSelectedAction((current) => (current + 1) % actions.length)
        return
      case "activate":
        void activate()
        return
      case "scroll-up": {
        const box = details.current
        if (box) box.scrollTo(Math.max(0, box.scrollTop - Math.max(1, box.viewport.height - 1)))
        return
      }
      case "scroll-down": {
        const box = details.current
        if (box) box.scrollTo(box.scrollTop + Math.max(1, box.viewport.height - 1))
        return
      }
      case "cancel":
        onClose()
        return
    }
  }, [actions.length, activate, exportPhase, fileExplorerActive, onClose, preempted, submitExport])
  useKeyboard(onKey)

  if (preempted) return null

  const displayName = controller.runtime(sessionId)?.displayName ?? sessionId
  return (
    <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column", overflow: "hidden" }}>
      <box style={{ flexShrink: 0, flexDirection: "column", border: true, borderColor: palette.accent, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={palette.accent}>{`${CONTEXT_PACK_TITLE} · ${displayName}`}</text>
        <text fg={palette.text}>{phaseLabel(draft, review, sealed, build?.state ?? null)}</text>
      </box>

      <scrollbox
        id={CONTEXT_PACK_SCROLLBOX_ID}
        ref={details}
        style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column", marginTop: 1 }}
        scrollX={false}
      >
        <CustodyDetails draft={draft} review={review} sealed={sealed} fit={fit} />
      </scrollbox>

      <ContextPackFileExplorer
        sessionId={sessionId}
        active={fileExplorerActive}
        onExit={() => {
          setFileExplorerActive(false)
          setNotice("Returned to Context Pack actions")
        }}
      />

      <box style={{ flexShrink: 0, flexDirection: "column", border: true, borderColor: palette.border, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={palette.text}>Explicit actions</text>
        {actions.map((action, index) => {
          const selected = index === selectedAction
          const status = action.enabled ? "available" : `unavailable — ${action.reason ?? "blocked"}`
          return (
            <text key={action.id} fg={selected ? palette.accent : action.enabled ? palette.text : palette.muted}>
              {`${selected ? "▶" : " "} [${selected ? "focused" : " "}] ${action.label} — ${status}`}
            </text>
          )
        })}
        {pendingAction ? <text fg={palette.accent}>{`Pending: ${pendingAction}`}</text> : null}
        {exportPhase === "destination" ? (
          <box style={{ flexDirection: "row" }}>
            <text fg={palette.text}>{`${CONTEXT_PACK_EXPORT_DESTINATION_LABEL}: `}</text>
            <input
              focused
              value={destination}
              placeholder="Exact Markdown path; Enter confirms write"
              onInput={setDestination}
              onSubmit={() => { void submitExport(false) }}
              style={{ flexGrow: 1, textColor: palette.text, cursorColor: palette.accent }}
            />
          </box>
        ) : null}
        {exportPhase === "overwrite" ? (
          <text fg={palette.context.warn}>{`Overwrite ${destination}? Enter confirms overwrite; Esc cancels.`}</text>
        ) : null}
        {notice ? <text fg={notice.startsWith("Blocked") || notice.startsWith("Denied") || notice.startsWith("Unavailable") ? palette.context.warn : palette.context.ok}>{notice}</text> : null}
        <text fg={palette.muted}>{CONTEXT_PACK_HINT}</text>
      </box>
    </box>
  )
}

function CustodyDetails({
  draft,
  review,
  sealed,
  fit,
}: {
  draft: DraftContextPack | null
  review: ContextPackReviewCandidate | null
  sealed: ContextPackSealedState | null
  fit: RecipientFit | null
}): ReactNode {
  const palette = usePalette()
  if (!draft && !review && !sealed) {
    return (
      <box style={{ flexDirection: "column" }}>
        <text fg={palette.muted}>Draft: unavailable</text>
        <text fg={palette.muted}>Sealed pack: unavailable</text>
        <text fg={palette.muted}>Freshness: unavailable — no draft</text>
        <text fg={palette.muted}>Recipient Fit: unavailable — no sealed pack</text>
      </box>
    )
  }

  const manifest = review?.manifest ?? (isLiveSealed(sealed) ? sealed.manifest : null)
  const visibleManifest: DraftContextPack | DraftContextPackManifest | null = draft ?? manifest
  return (
    <box style={{ flexDirection: "column" }}>
      {visibleManifest ? (
        <>
          <text fg={palette.text}>{`${draft ? "Draft" : "Sealed manifest"}: revision ${visibleManifest.revision}`}</text>
          <text fg={palette.text}>{`Pack Budget: ${visibleManifest.budget.limit} estimated tokens`}</text>
          {draft
            ? <text fg={freshnessTone(draft, palette)}>{freshnessLabel(draft)}</text>
            : <text fg={palette.context.warn}>Freshness: Sealed custody — recipient recheck required</text>}
          <text fg={palette.text}>{`Instructions (${visibleManifest.instructions.mode}): ${visibleManifest.instructions.original}`}</text>
          <text fg={palette.muted}>{`Discovered instructions: ${visibleManifest.instructions.discovered || "None"}`}</text>
          <text fg={palette.text}>Fixed Context Brief</text>
          <text fg={palette.text}>{`Architecture: ${visibleManifest.brief.architecture || "Not provided"}`}</text>
          <text fg={palette.text}>{`Selected Context: ${visibleManifest.brief.selectedContext || "Not provided"}`}</text>
          <text fg={palette.text}>{`Relationships: ${visibleManifest.brief.relationships || "Not provided"}`}</text>
          <text fg={palette.text}>{`Ambiguities: ${visibleManifest.brief.ambiguities || "None recorded"}`}</text>
          <text fg={palette.text}>{`Budget Omissions: ${visibleManifest.brief.budgetOmissions || "None recorded"}`}</text>
          <text fg={palette.text}>{`Selections: ${visibleManifest.selections.length}`}</text>
          {visibleManifest.selections.map((selection, index) => (
            <SelectionDetails key={`${selection.kind}:${selection.path}:${index}`} selection={selection} index={index} />
          ))}
        </>
      ) : null}

      {review ? (
        <>
          <text fg={review.verdict.kind === "ready" ? palette.context.ok : palette.context.warn}>
            {`Review: ${review.verdict.kind === "ready" ? "Ready to seal" : `Blocked — ${humanizeReason(review.verdict.reason)}`}`}
          </text>
          <text fg={palette.text}>{`Review bytes: ${review.bytes}`}</text>
          <text fg={palette.text}>{`Pack Estimate: ${review.packEstimate} estimated tokens`}</text>
          <text fg={palette.text}>{`Redactions: ${review.redactionCount}`}</text>
          <text fg={palette.accent}>{CONTEXT_PACK_EXACT_REVIEW_LABEL}</text>
          <text fg={palette.text}>{review.payload}</text>
        </>
      ) : <text fg={palette.muted}>Review candidate: unavailable</text>}

      {sealed ? (
        <>
          <text fg={palette.context.ok}>{`Sealed pack: revision ${sealed.revision} · ${sealed.bytes} bytes`}</text>
          <text fg={palette.text}>{`Sealed at: ${new Date(sealed.sealedAt).toISOString()}`}</text>
          <text fg={palette.accent}>{CONTEXT_PACK_EXACT_SEALED_LABEL}</text>
          <text fg={palette.text}>{sealed.payload}</text>
        </>
      ) : <text fg={palette.muted}>Sealed pack: unavailable</text>}
      <text fg={fit?.kind === "fit" ? palette.context.ok : palette.context.warn}>{recipientFitLabel(fit)}</text>
    </box>
  )
}

function SelectionDetails({ selection, index }: { selection: ContextSelection; index: number }): ReactNode {
  const palette = usePalette()
  const scope = selection.kind === "file_slice"
    ? `lines ${selection.range.startLine}-${selection.range.endLine}`
    : selection.kind === "diff"
      ? `${selection.scope} diff`
      : "full file"
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1 }}>
      <text fg={palette.accent}>{`Selection ${index + 1}: ${selection.path} · ${scope}`}</text>
      <text fg={palette.text}>{`Rationale: ${selection.rationale}`}</text>
      <text fg={palette.text}>{`Relationship: ${selection.relationship}`}</text>
      <text fg={palette.muted}>{`Source bytes: ${selection.source.bytes}`}</text>
    </box>
  )
}

function isLiveSealed(sealed: ContextPackSealedState | null): sealed is Extract<ContextPackSealedState, { manifest: unknown }> {
  return sealed !== null && "manifest" in sealed
}

function phaseLabel(
  draft: DraftContextPack | null,
  review: ContextPackReviewCandidate | null,
  sealed: ContextPackSealedState | null,
  buildState: "building" | "ready_for_review" | null,
): string {
  if (buildState === "building") return "Phase: Draft — Context Build running"
  if (review) return "Phase: Review candidate"
  if (draft) return "Phase: Draft"
  if (sealed) return "Phase: Sealed"
  return "Phase: Unavailable"
}

function freshnessLabel(draft: DraftContextPack): string {
  switch (draft.stale.kind) {
    case "fresh":
      return "Freshness: Fresh"
    case "needs_revalidation":
      return "Freshness: Needs revalidation"
    case "stale":
      return `Freshness: Stale — ${humanizeReason(draft.stale.reason)}`
  }
}

function freshnessTone(draft: DraftContextPack, palette: ReturnType<typeof usePalette>): string {
  return draft.stale.kind === "fresh" ? palette.context.ok : palette.context.warn
}

function denialReason(result: { readonly kind: "available" } | { readonly kind: "denied"; readonly reason: string }): string | null {
  return result.kind === "denied" ? humanizeReason(result.reason) : null
}

function fitReason(fit: RecipientFit | null): string | null {
  return fit?.kind === "fit" ? null : fit === null ? "Recipient Fit unavailable" : recipientFitLabel(fit)
}

function recipientFitLabel(fit: RecipientFit | null): string {
  if (fit === null) return "Recipient Fit: unavailable — no sealed pack"
  switch (fit.kind) {
    case "fit":
      return `Recipient Fit: Fits — exact count ${fit.exactCount}, remaining ${fit.remaining}`
    case "unavailable":
      return `Recipient Fit: Unavailable — ${humanizeReason(fit.reason)}`
    case "insufficient":
      return `Recipient Fit: Insufficient — exact count ${fit.exactCount}, remaining ${fit.remaining}`
  }
}

function humanizeReason(reason: string): string {
  const words = reason.replaceAll("_", " ").replaceAll("-", " ")
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}
