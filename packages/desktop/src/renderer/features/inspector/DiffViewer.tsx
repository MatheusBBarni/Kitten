import { Alert, Button } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type {
  ContractErrorCode,
  ReviewEvidenceFileSummary,
} from "../../../shared/rpc.ts";
import type { DesktopRpcClient } from "../../client.ts";
import { reviewDiffChunkQueryOptions } from "../../query/desktopQueries.ts";

export const REVIEW_FILE_PATCH_LIMIT_BYTES = 8 * 1024 * 1024;

function recoveryMessage(code: ContractErrorCode): string {
  switch (code) {
    case "evidence_missing":
      return "This file's review evidence is missing. Reload the manifest after evidence capture finishes.";
    case "evidence_stale":
    case "stale_projection":
      return "This diff is stale. Reload the manifest and review the current file before choosing a disposition.";
    case "evidence_oversized":
      return "This file exceeds the review limit. Reduce the change set and capture review evidence again.";
    case "evidence_unsafe":
      return "This file contains unsupported or unsafe review evidence. Resolve the unsafe change and capture evidence again.";
    case "worktree_binding_mismatch":
      return "The task worktree binding changed. Reload the card and review the newly captured evidence.";
    default:
      return "This diff is unavailable. Reload the manifest and try again.";
  }
}

function fileLabel(file: ReviewEvidenceFileSummary): string {
  if (file.oldPath !== null && file.newPath !== null && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? "Changed file";
}

export function DiffViewer({
  client,
  evidenceId,
  file,
}: {
  readonly client: DesktopRpcClient;
  readonly evidenceId: string;
  readonly file: ReviewEvidenceFileSummary;
}) {
  const [offsetHistory, setOffsetHistory] = useState<readonly number[]>([0]);
  const [position, setPosition] = useState(0);
  const offset = offsetHistory[position] ?? 0;
  const oversized = file.patchByteLength > REVIEW_FILE_PATCH_LIMIT_BYTES;
  const reviewable = !file.isBinary && !oversized;
  const chunkQuery = useQuery({
    ...reviewDiffChunkQueryOptions(client, evidenceId, file.fileId, offset),
    enabled: reviewable,
  });
  const label = fileLabel(file);

  if (file.isBinary) {
    return (
      <div className="grid gap-2">
        <Alert status="default" role="status">
          <Alert.Content>
            <Alert.Description>
              Binary file. Text patch content was not requested. Review its metadata and content digest before choosing a disposition.
            </Alert.Description>
          </Alert.Content>
        </Alert>
        <dl className="grid gap-1 text-xs sm:grid-cols-2" aria-label={`Binary metadata for ${label}`}>
          <div><dt className="text-muted">Status</dt><dd className="m-0">{file.status}</dd></div>
          <div><dt className="text-muted">Patch bytes</dt><dd className="m-0">{file.patchByteLength}</dd></div>
          <div><dt className="text-muted">Old mode</dt><dd className="m-0 font-mono">{file.oldMode ?? "None"}</dd></div>
          <div><dt className="text-muted">New mode</dt><dd className="m-0 font-mono">{file.newMode ?? "None"}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Content digest</dt>
            <dd className="m-0 break-all font-mono">{file.contentDigest ?? "Unavailable"}</dd>
          </div>
        </dl>
      </div>
    );
  }

  if (oversized) {
    return (
      <Alert status="warning" role="status">
        <Alert.Content>
          <Alert.Description>
            This file exceeds the 8 MiB text-review limit. Reduce the change set and capture review evidence again.
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  if (chunkQuery.isPending || chunkQuery.isFetching) {
    return (
      <Alert status="default" aria-busy="true" role="status">
        <Alert.Content>
          <Alert.Description>Loading one bounded chunk for {label} at offset {offset}…</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  if (chunkQuery.isError) {
    return (
      <Alert status="danger" role="alert">
        <Alert.Content>
          <Alert.Description>The desktop host did not return this diff chunk. Reload the manifest and try again.</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  const envelope = chunkQuery.data;
  if (envelope.result.status === "unavailable") {
    return (
      <Alert status="danger" role="alert">
        <Alert.Content>
          <Alert.Description>
            This diff is unavailable while the desktop host is not ready. Reconnect the host, then reload the manifest.
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }
  if (envelope.result.status === "rejected") {
    return (
      <Alert status="warning" role="alert">
        <Alert.Content>
          <Alert.Description>{recoveryMessage(envelope.result.error.code)}</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  const chunk = envelope.result.projection;
  if (
    chunk.evidenceId !== evidenceId
    || chunk.fileId !== file.fileId
    || chunk.offset !== offset
  ) {
    return (
      <Alert status="warning" role="alert">
        <Alert.Content>
          <Alert.Description>
            The returned chunk no longer matches the selected file. Reload the manifest before continuing review.
          </Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  const next = chunk.nextOffset;
  return (
    <section className="grid gap-2" aria-label={`Diff chunk for ${label}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span role="status" aria-live="polite">
          Chunk {position + 1} · offset {chunk.offset} · {chunk.complete ? "complete" : "more available"}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={position === 0}
            onPress={() => setPosition((current) => Math.max(0, current - 1))}
          >
            Previous chunk
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={next === null}
            onPress={() => {
              if (next === null) return;
              const knownPosition = offsetHistory.indexOf(next);
              if (knownPosition >= 0) {
                setPosition(knownPosition);
                return;
              }
              setOffsetHistory((current) => [...current.slice(0, position + 1), next]);
              setPosition(position + 1);
            }}
          >
            Next chunk
          </Button>
        </div>
      </div>
      <pre
        className="m-0 max-h-[32rem] overflow-auto rounded-md border border-separator bg-[var(--surface-secondary)] p-3 font-mono text-xs leading-5 text-foreground"
        tabIndex={0}
        aria-label={`Patch content for ${label}, chunk ${position + 1}`}
      >
        {chunk.content.length === 0 ? "No textual patch content in this chunk." : chunk.content}
      </pre>
    </section>
  );
}
