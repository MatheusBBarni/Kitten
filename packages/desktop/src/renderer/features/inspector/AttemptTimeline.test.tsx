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
    expect(markup).toContain("Agent message");
    expect(markup).toContain("Plan activity");
    expect(markup).toContain("Operator message");
    expect(markup).toContain("Tool activity");
    expect(markup).toContain("Operator follow-up");
    expect(markup).toContain("Awaiting confirmation");
    expect(markup).toContain("Attention question");
    expect(markup).toContain("Attention outcome");
    expect(markup).toContain("Question skipped");
    expect(markup).toContain("Attempt interrupted");

    expect(markup.indexOf("Agent message")).toBeLessThan(markup.indexOf("Operator message"));
    expect(markup.indexOf("Operator message")).toBeLessThan(markup.indexOf("Tool activity"));
    expect(markup.indexOf("Tool activity")).toBeLessThan(markup.indexOf("Operator follow-up"));
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

    expect(markup.match(/<details/g)).toHaveLength(2);
    expect(markup.match(/<details[^>]* open=""/g)).toHaveLength(1);
    expect(markup.indexOf("Attempt 1")).toBeLessThan(markup.indexOf("Attempt 2"));
  });
});
