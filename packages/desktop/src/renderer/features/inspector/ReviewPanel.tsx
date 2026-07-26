import { Alert, Button, Chip } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { InspectorReviewEvidenceSummary } from "../../../attempts/inspectorProjection.ts";
import type {
  ContractError,
  ReviewEvidenceFileSummary,
  ReviewEvidenceManifest,
} from "../../../shared/rpc.ts";
import type { CardProjection } from "../../../workflow/workflowTypes.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { reviewManifestQueryOptions } from "../../query/desktopQueries.ts";
import { DiffViewer } from "./DiffViewer.tsx";

function unavailableCopy(error: ContractError): string {
  switch (error.code) {
    case "evidence_missing":
      return "Review evidence is missing. Retry evidence capture after the final attempt settles, then reload the review.";
    case "evidence_stale":
    case "stale_projection":
      return "Review evidence changed. Reload the manifest and review the current files before choosing a disposition.";
    case "evidence_oversized":
      return "This change set exceeds the review limit. Reduce the change set and capture review evidence again.";
    case "evidence_unsafe":
      return "This change set contains unsupported or unsafe evidence. Resolve the unsafe change and capture review evidence again.";
    case "worktree_binding_mismatch":
      return "The task worktree binding changed. Reload the card and review the newly captured evidence.";
    default:
      return "Review evidence is unavailable in the task's current state. Reload the card before trying again.";
  }
}

function pathLabel(file: ReviewEvidenceFileSummary): string {
  if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? "Changed file";
}

function manifestMatches(
  card: CardProjection,
  evidence: InspectorReviewEvidenceSummary,
  manifest: ReviewEvidenceManifest,
): boolean {
  return manifest.cardId === card.cardId
    && manifest.boardId === card.boardId
    && manifest.evidenceId === evidence.evidenceId
    && manifest.evidenceDigest === evidence.evidenceDigest
    && manifest.attemptId === evidence.attemptId
    && manifest.generation === evidence.generation
    && manifest.worktreeBindingId === evidence.worktreeBindingId;
}

function DisabledDispositionActions() {
  return (
    <div className="flex flex-wrap gap-2 border-t border-separator pt-3">
      <Button isDisabled>Approve</Button>
      <Button variant="secondary" isDisabled>Request changes</Button>
      <span className="self-center text-xs text-muted">Dispositions require host-declared current evidence.</span>
    </div>
  );
}

export function ReviewPanel({
  client,
  card,
  evidence,
  busy,
  onApprove,
  onRequestChanges,
  onClose,
  onReload,
  selectedFileId: controlledSelectedFileId,
  onSelectedFileChange = () => {},
}: {
  readonly client: DesktopRpcClient;
  readonly card: CardProjection;
  readonly evidence: InspectorReviewEvidenceSummary;
  readonly busy: boolean;
  readonly onApprove: (manifest: ReviewEvidenceManifest) => void;
  readonly onRequestChanges: (manifest: ReviewEvidenceManifest) => void;
  readonly onClose: () => void;
  readonly onReload: () => Promise<void>;
  readonly selectedFileId?: string | null;
  readonly onSelectedFileChange?: (fileId: string | null) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const selectedFileIdentityRef = useRef<{
    readonly oldPath: string | null;
    readonly newPath: string | null;
  } | null>(null);
  const [internalSelectedFileId, setInternalSelectedFileId] = useState<string | null>(null);
  const selectedFileId = controlledSelectedFileId === undefined
    ? internalSelectedFileId
    : controlledSelectedFileId;
  const selectFile = (fileId: string | null) => {
    if (controlledSelectedFileId === undefined) setInternalSelectedFileId(fileId);
    onSelectedFileChange(fileId);
  };
  const manifestQuery = useQuery(reviewManifestQueryOptions(client, card.cardId, evidence.evidenceId));
  const availableManifest = manifestQuery.data?.result.status === "ok"
    ? manifestQuery.data.result.projection
    : null;
  const exactSelectedFile = availableManifest?.files.find(
    (file) => file.fileId === selectedFileId,
  ) ?? null;
  const restoredSelectedFile = exactSelectedFile ?? (
    selectedFileId === null || selectedFileIdentityRef.current === null
      ? null
      : availableManifest?.files.find((file) => (
          file.oldPath === selectedFileIdentityRef.current?.oldPath
          && file.newPath === selectedFileIdentityRef.current?.newPath
        )) ?? null
  );

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (exactSelectedFile !== null) {
      selectedFileIdentityRef.current = {
        oldPath: exactSelectedFile.oldPath,
        newPath: exactSelectedFile.newPath,
      };
      return;
    }
    if (restoredSelectedFile !== null && restoredSelectedFile.fileId !== selectedFileId) {
      selectFile(restoredSelectedFile.fileId);
    }
  }, [exactSelectedFile, restoredSelectedFile, selectedFileId]);

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow">Trustworthy review</p>
        <h3 id="review-panel-title" className="m-0 text-base">Changed files</h3>
      </div>
      <Button id="review-panel-close" size="sm" variant="ghost" onPress={onClose}>Close review</Button>
    </header>
  );

  if (manifestQuery.isPending || manifestQuery.isFetching) {
    return (
      <section
        ref={panelRef}
        tabIndex={-1}
        className="grid gap-3 rounded-md border border-separator bg-[var(--surface-secondary)] p-3"
        aria-labelledby="review-panel-title"
      >
        {header}
        <Alert status="default" aria-busy="true" role="status">
          <Alert.Content>
            <Alert.Description>Loading the review manifest before any disposition is available…</Alert.Description>
          </Alert.Content>
        </Alert>
        <DisabledDispositionActions />
      </section>
    );
  }

  if (manifestQuery.isError) {
    return (
      <section ref={panelRef} tabIndex={-1} className="grid gap-3 rounded-md border border-separator p-3" aria-labelledby="review-panel-title">
        {header}
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Description>The desktop host did not return the review manifest. Reconnect it, then reload the review.</Alert.Description>
          </Alert.Content>
        </Alert>
        <Button variant="secondary" onPress={() => void onReload()}>Reload manifest</Button>
        <DisabledDispositionActions />
      </section>
    );
  }

  const envelope = manifestQuery.data;
  if (envelope.result.status === "unavailable") {
    return (
      <section ref={panelRef} tabIndex={-1} className="grid gap-3 rounded-md border border-separator p-3" aria-labelledby="review-panel-title">
        {header}
        <Alert status="danger" role="alert">
          <Alert.Content>
            <Alert.Description>
              Review is unavailable while the desktop host is not ready. Reconnect the host, then reload the review.
            </Alert.Description>
          </Alert.Content>
        </Alert>
        <Button variant="secondary" onPress={() => void onReload()}>Reload manifest</Button>
        <DisabledDispositionActions />
      </section>
    );
  }
  if (envelope.result.status === "rejected") {
    return (
      <section ref={panelRef} tabIndex={-1} className="grid gap-3 rounded-md border border-separator p-3" aria-labelledby="review-panel-title">
        {header}
        <Alert status="warning" role="alert">
          <Alert.Content><Alert.Description>{unavailableCopy(envelope.result.error)}</Alert.Description></Alert.Content>
        </Alert>
        <Button variant="secondary" onPress={() => void onReload()}>Reload manifest</Button>
        <DisabledDispositionActions />
      </section>
    );
  }

  const manifest = envelope.result.projection;
  const identityMatches = manifestMatches(card, evidence, manifest);
  const availabilityError = manifest.availability.status === "unavailable"
    ? manifest.availability.error
    : null;
  const current = identityMatches
    && manifest.availability.status === "available"
    && card.executionStatus === "ready_for_review";
  const effectiveSelectedFileId = restoredSelectedFile?.fileId ?? selectedFileId;
  const selectedFile = restoredSelectedFile;

  return (
    <section
      ref={panelRef}
      id="review-panel"
      tabIndex={-1}
      className="grid gap-4 rounded-md border border-separator bg-[var(--surface-secondary)] p-3"
      aria-labelledby="review-panel-title"
    >
      {header}

      <dl className="grid gap-2 text-xs sm:grid-cols-2" aria-label="Review manifest identity">
        <div><dt className="text-muted">Card</dt><dd className="m-0 font-mono">{manifest.cardId}</dd></div>
        <div><dt className="text-muted">Attempt</dt><dd className="m-0 font-mono">{manifest.attemptId} · generation {Number(manifest.generation)}</dd></div>
        <div><dt className="text-muted">Evidence</dt><dd className="m-0 break-all font-mono">{manifest.evidenceId}</dd></div>
        <div><dt className="text-muted">Worktree binding</dt><dd className="m-0 break-all font-mono">{manifest.worktreeBindingId}</dd></div>
        <div className="sm:col-span-2"><dt className="text-muted">Evidence digest</dt><dd className="m-0 break-all font-mono">{manifest.evidenceDigest}</dd></div>
      </dl>

      {!identityMatches ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Description>
              The loaded manifest no longer matches this card and attempt. Reload the review before choosing a disposition.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : availabilityError !== null ? (
        <Alert status="warning" role="alert">
          <Alert.Content><Alert.Description>{unavailableCopy(availabilityError)}</Alert.Description></Alert.Content>
        </Alert>
      ) : manifest.availability.status !== "available" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Description>
              Review evidence is not available for this card. Retry evidence capture after the final attempt settles, then reload the review.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : card.executionStatus !== "ready_for_review" ? (
        <Alert status="warning" role="alert">
          <Alert.Content>
            <Alert.Description>
              This card is no longer ready for review. Reload the card before choosing a disposition.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <p className="m-0 text-sm" role="status" aria-live="polite">
          <Chip size="sm" variant="soft" color="success">Current evidence</Chip>
          <span className="ml-2">{manifest.fileCount} {manifest.fileCount === 1 ? "file" : "files"} · {manifest.totalPatchBytes} patch bytes</span>
        </p>
      )}

      <div className="grid gap-2">
        <h4 className="m-0 text-sm">Files in canonical order</h4>
        {manifest.files.length === 0 ? (
          <Alert status="default" role="status">
            <Alert.Content>
              <Alert.Description>No changed files are present in this manifest. Reload after evidence capture completes.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : (
          <ol className="grid max-h-56 gap-1 overflow-y-auto p-0" aria-label="Changed files">
            {manifest.files.map((file) => {
              const label = pathLabel(file);
              const selected = effectiveSelectedFileId === file.fileId;
              return (
                <li key={file.fileId} className="list-none">
                  <button
                    type="button"
                    data-native-file-id={file.fileId}
                    className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-separator bg-[var(--background)] px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
                    aria-pressed={selected}
                    onClick={() => selectFile(file.fileId)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">{label}</span>
                      <span className="block text-xs text-muted">
                        {file.status} · {file.isBinary ? "binary" : `${file.patchByteLength} patch bytes`}
                      </span>
                    </span>
                    <span className="text-xs text-muted">
                      {file.additions === null ? "" : `+${file.additions}`}
                      {file.deletions === null ? "" : ` −${file.deletions}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="grid gap-2" aria-live="polite">
        <h4 className="m-0 text-sm">Selected file</h4>
        {effectiveSelectedFileId === null ? (
          <Alert status="default" role="status">
            <Alert.Content>
              <Alert.Description>Select a text file to request its first bounded diff chunk. Binary files show metadata only.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : selectedFile === null ? (
          <Alert status="warning" role="alert">
            <Alert.Content>
              <Alert.Description>
                The selected file is missing from the current manifest. Choose another file or reload the review.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : (
          <DiffViewer
            key={`${manifest.evidenceId}:${selectedFile.fileId}`}
            client={client}
            evidenceId={manifest.evidenceId}
            file={selectedFile}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-separator pt-3">
        <Button
          isDisabled={!current || busy}
          isPending={busy}
          onPress={() => onApprove(manifest)}
        >
          Approve
        </Button>
        <Button
          variant="secondary"
          isDisabled={!current || busy}
          onPress={() => onRequestChanges(manifest)}
        >
          Request changes
        </Button>
        {!current ? (
          <span className="self-center text-xs text-muted">Dispositions require host-declared current evidence.</span>
        ) : null}
      </div>
    </section>
  );
}
