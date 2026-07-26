import { afterEach, describe, expect, test } from "bun:test";
import "../../settings/testDom.ts";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { AttemptTimeline } from "./AttemptTimeline.tsx";
import {
  inspectorAttempt,
  inspectorProjection,
  reviewManifest,
  TEST_ATTEMPT_ID,
} from "./testSupport.ts";

afterEach(cleanup);

describe("AttemptTimeline", () => {
  test("renders cockpit-style chronological message, activity, question, and terminal evidence", () => {
    const projection = inspectorProjection({
      status: "failed",
      terminalOutcome: "interrupted",
      queue: "settled",
      blocker: "settled",
    });
    const markup = renderToStaticMarkup(<AttemptTimeline projection={projection} />);

    expect(markup).toContain("Orchestrated Work History");
    expect(markup).toContain(">Run Context<");
    expect(markup).toContain("Immutable card title");
    expect(markup).toContain("execute-task");
    expect(markup).toContain(">Agent<");
    expect(markup).toContain(">Plan<");
    expect(markup).toContain("Keep the draft safe.");
    expect(markup).toContain(">read<");
    expect(markup).not.toContain("Operator follow-up");
    expect(markup).not.toContain("Awaiting confirmation");
    expect(markup).toContain("Attention question");
    expect(markup).toContain("Attention outcome");
    expect(markup).toContain("Question skipped");
    expect(markup).toContain("Run interrupted");
    expect(markup).toContain("Technical activity");

    expect(markup.indexOf(">Agent<")).toBeLessThan(markup.indexOf("Keep the draft safe."));
    expect(markup.indexOf("Keep the draft safe.")).toBeLessThan(markup.indexOf(">read<"));
    expect(markup.indexOf(">read<")).toBeLessThan(markup.indexOf("Attention question"));
  });

  test("keeps controlled older selection open and preserves attempt chronology", () => {
    const newest = inspectorProjection();
    const older = {
      ...inspectorAttempt("succeeded"),
      attemptId: "attempt-older" as typeof newest.attempts[number]["attemptId"],
      generation: 1 as typeof newest.attempts[number]["generation"],
    };
    const projection = { ...newest, attempts: [older, newest.attempts[0]!] };
    const markup = renderToStaticMarkup(
      <AttemptTimeline projection={projection} selectedAttemptId={older.attemptId} />,
    );

    expect(markup.match(/data-slot="accordion-item"/g)).toHaveLength(2);
    expect(markup.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(markup.indexOf("Attempt 1")).toBeLessThan(markup.indexOf("Attempt 2"));
    expect(markup.indexOf('id="attempt-older"')).toBeLessThan(markup.indexOf('aria-expanded="true"'));
  });

  test("uses deterministic message, activity, and blocker ordering at equal timestamps", () => {
    const base = inspectorProjection({ blocker: "active" });
    const attempt = {
      ...base.attempts[0]!,
      entries: base.attempts[0]!.entries.map((entry) => ({
        ...entry,
        evidence: {
          ...entry.evidence,
          firstOccurredAt: 110,
          lastOccurredAt: 110,
        },
      })),
    };
    const projection = { ...base, attempts: [attempt] };
    const markup = renderToStaticMarkup(<AttemptTimeline projection={projection} />);

    expect(markup.indexOf("I am inspecting the code.")).toBeLessThan(markup.indexOf("Keep the draft safe."));
    expect(markup.indexOf("Keep the draft safe.")).toBeLessThan(markup.indexOf(">Plan<"));
    expect(markup.indexOf(">Plan<")).toBeLessThan(markup.indexOf("Attention question"));
  });

  test("attaches manifest-only changed-file evidence to its producing attempt", async () => {
    const opened: string[] = [];
    const projection = inspectorProjection({ evidence: true });
    const view = render(
      <AttemptTimeline
        projection={projection}
        selectedAttemptId={TEST_ATTEMPT_ID}
        reviewManifests={[reviewManifest()]}
        onOpenReview={(manifest) => opened.push(manifest.evidenceId)}
      />,
    );

    expect(view.getByLabelText("Changed files from attempt 2")).toBeDefined();
    expect(view.getByText("1 file")).toBeDefined();
    await userEvent.setup().click(view.getByRole("button", { name: "Open review" }));
    expect(opened).toEqual(["evidence-inspector-renderer"]);
  });
});
