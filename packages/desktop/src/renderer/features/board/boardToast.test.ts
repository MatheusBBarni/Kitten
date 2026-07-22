import { afterEach, describe, expect, test } from "bun:test";
import { toast } from "@heroui/react";
import { showBoardToast } from "./boardToast.ts";

afterEach(() => toast.clear());

describe("board toast feedback", () => {
  test("queues success, informational, and error feedback through HeroUI", () => {
    showBoardToast({ message: "Board projection committed.", tone: "success" });
    showBoardToast({ message: "Repository folder selected.", tone: "info" });
    showBoardToast({ message: "The action could not be completed.", tone: "error" });

    const queued = toast.getQueue().visibleToasts.map(({ content, timeout }) => ({
      title: content.title,
      variant: content.variant,
      timeout,
    }));
    expect(queued).toHaveLength(3);
    expect(queued).toContainEqual({ title: "Board projection committed.", variant: "success", timeout: 5_000 });
    expect(queued).toContainEqual({ title: "Repository folder selected.", variant: "accent", timeout: 5_000 });
    expect(queued).toContainEqual({ title: "The action could not be completed.", variant: "danger", timeout: 5_000 });
  });
});
