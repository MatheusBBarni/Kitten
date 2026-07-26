import type { AttemptId } from "@kitten/engine";
import { Accordion, Button } from "@heroui/react";
import type { Key } from "@heroui/react";
import { useMemo } from "react";
import type {
  AttemptInspectorProjection,
  CardInspectorProjection,
  InspectorTranscriptEntry,
} from "../../../attempts/inspectorProjection.ts";
import type { AttentionBlockerProjection, AttentionOutcome } from "../../../attention/contracts.ts";
import type { ReviewEvidenceManifest } from "../../../shared/rpc.ts";
import { ChevronDownIcon } from "../../components/Icons.tsx";

interface AttemptTimelineProps {
  readonly projection: CardInspectorProjection;
  readonly selectedAttemptId?: string | null;
  readonly onSelectedAttemptChange?: (attemptId: string) => void;
  readonly reviewManifests?: readonly ReviewEvidenceManifest[];
  readonly onOpenReview?: (manifest: ReviewEvidenceManifest) => void;
}

type TimelineItem = {
  readonly key: string;
  readonly occurredAt: number;
  readonly priority: number;
  readonly sequence: number;
  readonly kind: "message" | "technical" | "blocker";
  readonly content: React.ReactNode;
};

type TimelineGroup =
  | { readonly kind: "primary"; readonly item: TimelineItem }
  | { readonly kind: "technical"; readonly key: string; readonly items: readonly TimelineItem[] };

function outcomeLabel(outcome: AttentionOutcome): string {
  if (outcome.kind === "submitted") return "Answer submitted";
  if (outcome.kind === "skipped") return "Question skipped";
  if (outcome.kind === "timed_out") return "Question timed out";
  return "Question cancelled";
}

function transcriptContent(entry: InspectorTranscriptEntry): React.ReactNode {
  if (entry.kind === "agent") {
    return <div className="grid gap-1"><span className="text-xs text-muted">Agent</span><p className="transcript-text m-0 text-sm leading-6 text-foreground">{entry.text}</p></div>;
  }
  if (entry.kind === "user") {
    return <div className="rounded-md bg-[var(--accent-soft)] px-3 py-2 text-[var(--accent-soft-foreground)]"><p className="transcript-text m-0 text-sm leading-6">{entry.text}</p></div>;
  }
  if (entry.kind === "tool") {
    const title = entry.call.title ?? entry.call.kind ?? "Tool";
    const status = entry.call.status ?? "updated";
    return (
      <div className="grid gap-1 text-sm">
        <p className="m-0"><span className="text-[var(--accent)]">●</span> <strong>{title}</strong> <span className="text-muted">· {status.replaceAll("_", " ")}</span></p>
        {entry.call.locations === undefined || entry.call.locations.length === 0 ? null : (
          <ul className="m-0 list-none p-0 text-xs text-muted">{entry.call.locations.map((location) => <li key={location}>└ {location}</li>)}</ul>
        )}
      </div>
    );
  }
  if (entry.kind === "terminal") {
    return <p className="m-0 text-sm"><strong>Run {entry.outcome}</strong></p>;
  }
  if (entry.activity.kind === "plan") {
    return (
      <>
        <strong className="text-xs text-muted">Plan</strong>
        <ol className="mt-1 grid gap-1 pl-5 text-sm">{entry.activity.entries.map((plan, index) => <li key={`${plan.content}:${index}`}>{plan.content} <span className="text-muted">· {plan.status}</span></li>)}</ol>
      </>
    );
  }
  if (entry.activity.kind === "usage") return null;
  return <p className="m-0 text-xs text-muted">Run state changed to {entry.activity.state}.</p>;
}

function itemsForAttempt(
  attempt: AttemptInspectorProjection,
  blockers: readonly AttentionBlockerProjection[],
  projection: CardInspectorProjection,
): readonly TimelineItem[] {
  const items: TimelineItem[] = attempt.entries.flatMap((entry) => {
    const content = transcriptContent(entry);
    return content === null ? [] : [{
      key: `entry:${entry.evidence.eventIds.join(":")}`,
      occurredAt: entry.evidence.firstOccurredAt,
      priority: entry.kind === "user" || entry.kind === "agent" ? 0 : 1,
      sequence: Number(entry.evidence.firstSequence),
      kind: entry.kind === "user" || entry.kind === "agent" ? "message" : "technical",
      content,
    }];
  });

  for (const blocker of blockers) {
    items.push({
      key: `blocker:${blocker.blockerId}:raised`,
      occurredAt: blocker.createdAt,
      priority: 2,
      sequence: Number.MAX_SAFE_INTEGER,
      kind: "blocker",
      content: (
        <>
          <strong>Attention question</strong>
          <p>{blocker.form.prompt}</p>
          <p className="event-state">{blocker.active ? "Answer required" : "Settled"}</p>
        </>
      ),
    });
    if (blocker.outcome !== null && blocker.terminalAt !== null) {
      items.push({
        key: `blocker:${blocker.blockerId}:outcome`,
        occurredAt: blocker.terminalAt,
        priority: 2,
        sequence: Number.MAX_SAFE_INTEGER,
        kind: "blocker",
        content: <><strong>Attention outcome</strong><p>{outcomeLabel(blocker.outcome)}.</p></>,
      });
    }
  }

  const state = projection.attemptStates.find(({ attemptId }) => attemptId === attempt.attemptId);
  if (
    state !== undefined
    && state.terminalAt !== null
    && attempt.terminalOutcome === null
    && (state.state === "failed" || state.state === "cancelled" || state.state === "interrupted" || state.state === "succeeded")
  ) {
    items.push({
      key: `attempt:${attempt.attemptId}:terminal`,
      occurredAt: state.terminalAt,
      priority: 1,
      sequence: Number.MAX_SAFE_INTEGER,
      kind: "technical",
      content: (
        <>
          <strong>Terminal outcome</strong>
          <p>Attempt {state.state}.</p>
          {state.failure === null ? null : <p>{state.failure.message}</p>}
        </>
      ),
    });
  }

  const queue = projection.followUpQueues.find(({ attemptId }) => attemptId === attempt.attemptId);
  for (const draft of queue?.drafts ?? []) {
    const label = draft.state === "queued"
      ? "Direction queued"
      : draft.state === "dispatching"
        ? "Direction dispatching"
        : draft.state === "dispatched"
          ? "Direction dispatched"
          : draft.state === "interrupted"
            ? "Direction interrupted"
            : "Direction removed";
    items.push({
      key: `direction:${draft.queueId}:${draft.state}`,
      occurredAt: draft.updatedAt,
      priority: 1,
      sequence: Number.MAX_SAFE_INTEGER,
      kind: "technical",
      content: <p className="m-0 text-sm"><strong>{label}</strong></p>,
    });
  }

  return items.sort((left, right) => (
    left.occurredAt - right.occurredAt
    || left.priority - right.priority
    || left.sequence - right.sequence
    || left.key.localeCompare(right.key)
  ));
}

function groupTimelineItems(items: readonly TimelineItem[]): readonly TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let technical: TimelineItem[] = [];
  const flush = () => {
    if (technical.length === 0) return;
    groups.push({
      kind: "technical",
      key: `technical:${technical.map(({ key }) => key).join(":")}`,
      items: technical,
    });
    technical = [];
  };

  for (const item of items) {
    if (item.kind === "technical") {
      technical.push(item);
      continue;
    }
    flush();
    groups.push({ kind: "primary", item });
  }
  flush();
  return groups;
}

function ChangedFilesSummary({
  manifest,
  onOpenReview,
}: {
  readonly manifest: ReviewEvidenceManifest;
  readonly onOpenReview: (manifest: ReviewEvidenceManifest) => void;
}) {
  const additions = manifest.files.reduce((total, file) => total + (file.additions ?? 0), 0);
  const deletions = manifest.files.reduce((total, file) => total + (file.deletions ?? 0), 0);
  return (
    <section className="mt-3 rounded-md border border-separator p-3" aria-label={`Changed files from attempt ${Number(manifest.generation)}`}>
      <p className="eyebrow">Changed files</p>
      <p className="m-0 text-sm">
        <strong>{manifest.fileCount} {manifest.fileCount === 1 ? "file" : "files"}</strong>
        <span className="text-muted"> · +{additions} −{deletions}</span>
      </p>
      <Button
        data-desktop-command-target="open-review"
        className="mt-2"
        size="sm"
        variant="secondary"
        onPress={() => onOpenReview(manifest)}
      >
        Open review
      </Button>
    </section>
  );
}

function AttemptHistory({
  attempt,
  projection,
  manifest,
  onOpenReview,
}: {
  readonly attempt: AttemptInspectorProjection;
  readonly projection: CardInspectorProjection;
  readonly manifest: ReviewEvidenceManifest | null;
  readonly onOpenReview: (manifest: ReviewEvidenceManifest) => void;
}) {
  const blockers = projection.attentionBlockers.filter(({ attemptId }) => attemptId === attempt.attemptId);
  const items = itemsForAttempt(attempt, blockers, projection);
  const groups = groupTimelineItems(items);
  const title = `Attempt ${Number(attempt.generation)}`;

  return (
    <Accordion.Item id={attempt.attemptId} className="attempt-transcript">
      <Accordion.Heading>
        <Accordion.Trigger className="attempt-transcript-trigger">
          <span>{title}</span>
          <span className="event-state">{attempt.terminalOutcome ?? "In progress"}</span>
          <Accordion.Indicator><ChevronDownIcon /></Accordion.Indicator>
        </Accordion.Trigger>
      </Accordion.Heading>
      <Accordion.Panel>
        <Accordion.Body className="attempt-transcript-body">
          <details className="run-context rounded-md border border-separator p-3">
            <summary className="cursor-pointer text-sm font-medium">Run Context</summary>
            <dl className="run-context-facts mt-3">
              <div><dt>Card</dt><dd>{attempt.context.card.title}</dd></div>
              <div><dt>Workflow Stage</dt><dd>{attempt.context.stage.label}</dd></div>
              <div><dt>Workflow version</dt><dd>{attempt.context.workflow.version}</dd></div>
              <div><dt>Workflow Skill</dt><dd>{attempt.context.skill.name}</dd></div>
              <div><dt>Provider</dt><dd>{attempt.context.profile.provider}</dd></div>
              <div><dt>Model</dt><dd>{attempt.context.profile.model}</dd></div>
              <div><dt>Effort</dt><dd>{attempt.context.profile.effort}</dd></div>
              <div><dt>Execution binding</dt><dd>{attempt.context.executionBindingId}</dd></div>
            </dl>
          </details>
          {items.length === 0 ? (
            <p className="notice">This attempt has a Run Context but no recorded activity yet.</p>
          ) : (
            <ol className="timeline-events" aria-label={`${title} chronological events`}>
              {groups.map((group) => group.kind === "primary" ? (
                <li
                  key={group.item.key}
                  className={`grid gap-1 border-t border-separator pt-3 first:border-t-0 first:pt-0 ${group.item.kind === "message" ? "conversation-message" : "conversation-blocker"}`}
                >
                  <div>{group.item.content}</div>
                  <time className="text-[0.6875rem] text-muted" dateTime={new Date(group.item.occurredAt).toISOString()}>{new Date(group.item.occurredAt).toLocaleString()}</time>
                </li>
              ) : (
                <li key={group.key} className="border-t border-separator pt-3 first:border-t-0 first:pt-0">
                  <details className="technical-activity rounded-md border border-separator px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium text-muted">
                      Technical activity ({group.items.length})
                    </summary>
                    <ol className="mt-3 grid gap-3 pl-4">
                      {group.items.map((item) => (
                        <li key={item.key} className="grid gap-1">
                          <div>{item.content}</div>
                          <time className="text-[0.6875rem] text-muted" dateTime={new Date(item.occurredAt).toISOString()}>{new Date(item.occurredAt).toLocaleString()}</time>
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              ))}
            </ol>
          )}
          {manifest === null ? null : <ChangedFilesSummary manifest={manifest} onOpenReview={onOpenReview} />}
        </Accordion.Body>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export function AttemptTimeline({
  projection,
  selectedAttemptId = null,
  onSelectedAttemptChange = () => {},
  reviewManifests = [],
  onOpenReview = () => {},
}: AttemptTimelineProps) {
  const attempts = [...projection.attempts].sort((left, right) => Number(left.generation) - Number(right.generation));
  const effectiveAttemptId = attempts.some(({ attemptId }) => attemptId === selectedAttemptId)
    ? selectedAttemptId
    : attempts.at(-1)?.attemptId ?? null;
  const expandedKeys = useMemo(
    () => effectiveAttemptId === null ? new Set<Key>() : new Set<Key>([effectiveAttemptId]),
    [effectiveAttemptId],
  );
  return (
    <section className="attempt-timeline" aria-labelledby="work-history-title">
      <header>
        <p className="eyebrow">Durable evidence</p>
        <h3 id="work-history-title">Orchestrated Work History</h3>
      </header>
      {attempts.length === 0 ? (
        <p className="notice">No Run Attempts yet. Use the composer to start this card in its current Workflow Stage.</p>
      ) : (
        <Accordion
          className="attempt-list"
          expandedKeys={expandedKeys}
          onExpandedChange={(expandedKeys) => {
            const attemptId = [...expandedKeys].at(-1);
            if (typeof attemptId === "string") onSelectedAttemptChange(attemptId);
          }}
          variant="surface"
        >
          {attempts.map((attempt, index) => (
            <AttemptHistory
              key={attempt.attemptId as AttemptId}
              attempt={attempt}
              projection={projection}
              manifest={reviewManifests.find(({ attemptId }) => attemptId === attempt.attemptId) ?? null}
              onOpenReview={onOpenReview}
            />
          ))}
        </Accordion>
      )}
    </section>
  );
}
