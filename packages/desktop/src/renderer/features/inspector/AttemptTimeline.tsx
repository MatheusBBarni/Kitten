import type { AttemptId } from "@kitten/engine";
import { Accordion } from "@heroui/react";
import type {
  AttemptInspectorProjection,
  CardInspectorProjection,
  InspectorTranscriptEntry,
} from "../../../attempts/inspectorProjection.ts";
import type { AttentionBlockerProjection, AttentionOutcome } from "../../../attention/contracts.ts";
import type { FollowUpDraft, FollowUpQueueProjection } from "../../../attempts/followUpQueue.ts";
import { ChevronDownIcon } from "../../components/Icons.tsx";

interface AttemptTimelineProps {
  readonly projection: CardInspectorProjection;
}

type TimelineItem = {
  readonly key: string;
  readonly occurredAt: number;
  readonly priority: number;
  readonly content: React.ReactNode;
};

function outcomeLabel(outcome: AttentionOutcome): string {
  if (outcome.kind === "submitted") return "Answer submitted";
  if (outcome.kind === "skipped") return "Question skipped";
  if (outcome.kind === "timed_out") return "Question timed out";
  return "Question cancelled";
}

function draftStateLabel(draft: FollowUpDraft): string {
  if (draft.state === "awaiting_confirmation") return "Awaiting confirmation";
  if (draft.state === "confirmed") return "Confirmed";
  if (draft.state === "dispatched") return "Dispatched";
  if (draft.state === "removed") return "Removed";
  return "Queued";
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
  queue: FollowUpQueueProjection | undefined,
  blockers: readonly AttentionBlockerProjection[],
  projection: CardInspectorProjection,
): readonly TimelineItem[] {
  const items: TimelineItem[] = attempt.entries.flatMap((entry) => {
    const content = transcriptContent(entry);
    return content === null ? [] : [{
      key: `entry:${entry.evidence.eventIds.join(":")}`,
      occurredAt: entry.evidence.firstOccurredAt,
      priority: 1,
      content,
    }];
  });

  for (const draft of queue?.drafts ?? []) {
    items.push({
      key: `draft:${draft.queueId}`,
      occurredAt: draft.createdAt,
      priority: 2,
      content: (
        <>
          <strong>Operator follow-up</strong>
          <p className="transcript-text">{draft.text}</p>
          <p className="event-state">{draftStateLabel(draft)}</p>
        </>
      ),
    });
  }

  for (const blocker of blockers) {
    items.push({
      key: `blocker:${blocker.blockerId}:raised`,
      occurredAt: blocker.createdAt,
      priority: 3,
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
        priority: 4,
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
      priority: 5,
      content: (
        <>
          <strong>Terminal outcome</strong>
          <p>Attempt {state.state}.</p>
          {state.failure === null ? null : <p>{state.failure.message}</p>}
        </>
      ),
    });
  }

  return items.sort((left, right) => left.occurredAt - right.occurredAt || left.priority - right.priority || left.key.localeCompare(right.key));
}

function AttemptHistory({
  attempt,
  projection,
}: {
  readonly attempt: AttemptInspectorProjection;
  readonly projection: CardInspectorProjection;
}) {
  const queue = projection.followUpQueues.find(({ attemptId }) => attemptId === attempt.attemptId);
  const blockers = projection.attentionBlockers.filter(({ attemptId }) => attemptId === attempt.attemptId);
  const items = itemsForAttempt(attempt, queue, blockers, projection);
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
          <section className="run-context" aria-labelledby={`run-context-${attempt.attemptId}`}>
            <h4 id={`run-context-${attempt.attemptId}`}>Immutable Run Context</h4>
            <dl className="run-context-facts">
              <div><dt>Card</dt><dd>{attempt.context.card.title}</dd></div>
              <div><dt>Workflow Stage</dt><dd>{attempt.context.stage.label}</dd></div>
              <div><dt>Workflow version</dt><dd>{attempt.context.workflow.version}</dd></div>
              <div><dt>Workflow Skill</dt><dd>{attempt.context.skill.name}</dd></div>
              <div><dt>Provider</dt><dd>{attempt.context.profile.provider}</dd></div>
              <div><dt>Model</dt><dd>{attempt.context.profile.model}</dd></div>
              <div><dt>Effort</dt><dd>{attempt.context.profile.effort}</dd></div>
              <div><dt>Execution binding</dt><dd>{attempt.context.executionBindingId}</dd></div>
            </dl>
          </section>
          {items.length === 0 ? (
            <p className="notice">This attempt has a Run Context but no recorded activity yet.</p>
          ) : (
            <ol className="timeline-events" aria-label={`${title} chronological events`}>
              {items.map((item) => (
                <li key={item.key} className="grid gap-1 border-t border-separator pt-3 first:border-t-0 first:pt-0">
                  <div>{item.content}</div>
                  <time className="text-[0.6875rem] text-muted" dateTime={new Date(item.occurredAt).toISOString()}>{new Date(item.occurredAt).toLocaleString()}</time>
                </li>
              ))}
            </ol>
          )}
        </Accordion.Body>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export function AttemptTimeline({ projection }: AttemptTimelineProps) {
  const attempts = [...projection.attempts].sort((left, right) => Number(left.generation) - Number(right.generation));
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
          defaultExpandedKeys={[attempts.at(-1)!.attemptId]}
          allowsMultipleExpanded
          variant="surface"
        >
          {attempts.map((attempt, index) => (
            <AttemptHistory
              key={attempt.attemptId as AttemptId}
              attempt={attempt}
              projection={projection}
            />
          ))}
        </Accordion>
      )}
    </section>
  );
}
