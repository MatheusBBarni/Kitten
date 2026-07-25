import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AttemptTimeline } from "./AttemptTimeline.tsx";
import { inspectorAttempt, inspectorProjection } from "./testSupport.ts";

describe("AttemptTimeline", () => {
  test("renders durable context and chronological message, activity, question, operator, queue, and terminal evidence", () => {
    const projection = inspectorProjection({
      status: "failed",
      terminalOutcome: "interrupted",
      queue: "settled",
      blocker: "settled",
    });
    const markup = renderToStaticMarkup(<AttemptTimeline projection={projection} />);

    expect(markup).toContain("Orchestrated Work History");
    expect(markup).toContain("Immutable Run Context");
    expect(markup).toContain("Immutable card title");
    expect(markup).toContain("execute-task");
    expect(markup).toContain(">Agent<");
    expect(markup).toContain(">Plan<");
    expect(markup).toContain("Keep the draft safe.");
    expect(markup).toContain(">read<");
    expect(markup).toContain("Operator follow-up");
    expect(markup).toContain("Awaiting confirmation");
    expect(markup).toContain("Attention question");
    expect(markup).toContain("Attention outcome");
    expect(markup).toContain("Question skipped");
    expect(markup).toContain("Run interrupted");

    expect(markup.indexOf(">Agent<")).toBeLessThan(markup.indexOf("Keep the draft safe."));
    expect(markup.indexOf("Keep the draft safe.")).toBeLessThan(markup.indexOf(">read<"));
    expect(markup.indexOf(">read<")).toBeLessThan(markup.indexOf("Operator follow-up"));
    expect(markup.indexOf("Operator follow-up")).toBeLessThan(markup.indexOf("Attention question"));
  });

  test("expands only the newest transcript and preserves older chronology", () => {
    const newest = inspectorProjection();
    const older = {
      ...inspectorAttempt("succeeded"),
      attemptId: "attempt-older" as typeof newest.attempts[number]["attemptId"],
      generation: 1 as typeof newest.attempts[number]["generation"],
    };
    const projection = { ...newest, attempts: [older, newest.attempts[0]!] };
    const markup = renderToStaticMarkup(<AttemptTimeline projection={projection} />);

    expect(markup.match(/data-slot="accordion-item"/g)).toHaveLength(2);
    expect(markup.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(markup.indexOf("Attempt 1")).toBeLessThan(markup.indexOf("Attempt 2"));
  });
});
