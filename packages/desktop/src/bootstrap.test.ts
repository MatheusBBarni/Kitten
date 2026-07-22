import { expect, test } from "bun:test";
import { startDesktopBootstrap } from "./bootstrap.ts";

test("reports and preserves a native startup failure", async () => {
  const failure = new Error("window factory unavailable");
  const reported: unknown[] = [];

  await expect(startDesktopBootstrap({
    start: async () => { throw failure; },
    reportStartupFailure(error) {
      reported.push(error);
    },
  })).rejects.toBe(failure);

  expect(reported).toEqual([failure]);
});
