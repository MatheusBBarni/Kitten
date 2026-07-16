import { describe, expect, test } from "bun:test";

import {
  bindStarCountControls,
  fetchRepositoryStarCount,
  githubRepositoryEndpoint,
  mapStarState,
  parseStarCount,
  renderStarState,
  type Fetcher,
  type StarCopy,
} from "./star-count.ts";

const copy: StarCopy = {
  repositoryName: "Kitten",
  loadingText: "…",
  loadingAccessibleLabel: "Star Kitten on GitHub. The live star count is loading.",
  fallbackText: "—",
  fallbackAccessibleLabel:
    "Star Kitten on GitHub. The live star count is currently unavailable.",
};

type ControlHarness = {
  readonly control: HTMLElement;
  readonly statusElement: HTMLElement;
  readonly root: ParentNode;
  readonly attributes: Map<string, string>;
};

function createControl(
  dataset: Record<string, string> = {},
  includeStatus = true,
): ControlHarness {
  const attributes = new Map<string, string>([
    ["href", "https://github.com/MatheusBBarni/Kitten"],
    ["aria-label", copy.fallbackAccessibleLabel],
  ]);
  const statusElement = {
    textContent: copy.fallbackText,
  } as HTMLElement;
  const control = {
    dataset: {
      repoOwner: "MatheusBBarni",
      repoName: "Kitten",
      starLoadingText: copy.loadingText,
      starLoadingLabel: copy.loadingAccessibleLabel,
      starFallbackText: copy.fallbackText,
      starFallbackLabel: copy.fallbackAccessibleLabel,
      starStatus: "unavailable",
      ...dataset,
    },
    querySelector(selector: string) {
      return includeStatus && selector === "[data-star-status-text]"
        ? statusElement
        : null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
  } as unknown as HTMLElement;
  const root = {
    querySelectorAll(selector: string) {
      expect(selector).toBe("[data-star-control]");
      return [control];
    },
  } as unknown as ParentNode;

  return { control, statusElement, root, attributes };
}

describe("star response parsing and state mapping", () => {
  test.each([
    [{ stargazers_count: 0 }, 0],
    [{ stargazers_count: 1 }, 1],
    [{ stargazers_count: 12_345 }, 12_345],
  ] as const)("parses a valid GitHub star payload", (payload, expected) => {
    expect(parseStarCount(payload)).toBe(expected);
  });

  test.each([
    null,
    undefined,
    "42",
    {},
    { stargazers_count: "42" },
    { stargazers_count: -1 },
    { stargazers_count: 1.5 },
    { stargazers_count: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects malformed or fabricated counts: %p", (payload) => {
    expect(parseStarCount(payload)).toBeNull();
  });

  test("maps loading, success, singular, and unavailable copy", () => {
    expect(mapStarState("loading", copy)).toEqual({
      status: "loading",
      text: copy.loadingText,
      accessibleLabel: copy.loadingAccessibleLabel,
    });
    expect(mapStarState("ready", copy, 1)).toEqual({
      status: "ready",
      text: "1",
      accessibleLabel: "Star Kitten on GitHub. 1 star.",
    });
    expect(mapStarState("ready", copy, 12_345).text).toBe(
      "12,345",
    );
    expect(mapStarState("unavailable", copy)).toEqual({
      status: "unavailable",
      text: copy.fallbackText,
      accessibleLabel: copy.fallbackAccessibleLabel,
    });
    expect(mapStarState("ready", copy)).toEqual(
      mapStarState("unavailable", copy),
    );
  });
});

describe("GitHub repository request", () => {
  test("requests the configured repository without credentials or tracking state", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher: Fetcher = async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json({ stargazers_count: 321 });
    };

    expect(githubRepositoryEndpoint("owner name", "repo/name")).toBe(
      "https://api.github.com/repos/owner%20name/repo%2Fname",
    );
    expect(
      await fetchRepositoryStarCount("MatheusBBarni", "Kitten", fetcher),
    ).toBe(321);
    expect(calls).toEqual([
      {
        input: "https://api.github.com/repos/MatheusBBarni/Kitten",
        init: {
          method: "GET",
          headers: { Accept: "application/vnd.github+json" },
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        },
      },
    ]);
  });

  test.each([
    ["rate limited", async () => new Response("rate limited", { status: 403 })],
    ["API error", async () => new Response("missing", { status: 404 })],
    ["malformed", async () => Response.json({ stargazers_count: "many" })],
    [
      "network failure",
      async () => {
        throw new Error("offline");
      },
    ],
  ] satisfies readonly (readonly [string, Fetcher])[])(
    "returns unavailable data for %s",
    async (_label, fetcher) => {
      expect(
        await fetchRepositoryStarCount("MatheusBBarni", "Kitten", fetcher),
      ).toBeNull();
    },
  );

  test("does not request an incomplete repository", async () => {
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return Response.json({ stargazers_count: 1 });
    };

    expect(await fetchRepositoryStarCount(" ", "Kitten", fetcher)).toBeNull();
    expect(calls).toBe(0);
  });
});

describe("star control rendering and binding", () => {
  test("renders a state without changing the repository destination", () => {
    const { control, statusElement, attributes } = createControl();
    const state = mapStarState("ready", copy, 47);

    renderStarState(control, statusElement, state);

    expect(control.dataset.starStatus).toBe("ready");
    expect(statusElement.textContent).toBe("47");
    expect(attributes.get("aria-label")).toBe(state.accessibleLabel);
    expect(attributes.get("href")).toBe(
      "https://github.com/MatheusBBarni/Kitten",
    );
  });

  test("shows loading, updates a successful count, and requests only once", async () => {
    const { control, statusElement, root } = createControl();
    let resolveFetch: ((response: Response) => void) | undefined;
    let calls = 0;
    const fetcher: Fetcher = () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    };

    const firstBinding = bindStarCountControls(root, { fetcher });
    expect(control.dataset.starStatus).toBe("loading");
    expect(statusElement.textContent).toBe(copy.loadingText);
    expect(await bindStarCountControls(root, { fetcher })).toEqual([]);

    resolveFetch?.(Response.json({ stargazers_count: 88 }));
    expect(await firstBinding).toEqual([
      {
        status: "ready",
        text: "88",
        accessibleLabel: "Star Kitten on GitHub. 88 stars.",
      },
    ]);
    expect(calls).toBe(1);
    expect(control.dataset.starStatus).toBe("ready");
    expect(statusElement.textContent).toBe("88");
  });

  test.each([
    ["rate limit", async () => new Response("limited", { status: 403 })],
    [
      "network block",
      async () => {
        throw new Error("blocked");
      },
    ],
  ] satisfies readonly (readonly [string, Fetcher])[])(
    "restores the explicit fallback after a %s",
    async (_label, fetcher) => {
      const { control, statusElement, root, attributes } = createControl();

      expect(await bindStarCountControls(root, { fetcher })).toEqual([
        {
          status: "unavailable",
          text: copy.fallbackText,
          accessibleLabel: copy.fallbackAccessibleLabel,
        },
      ]);
      expect(control.dataset.starStatus).toBe("unavailable");
      expect(statusElement.textContent).toBe(copy.fallbackText);
      expect(statusElement.textContent).not.toBe("0");
      expect(attributes.get("href")).toBe(
        "https://github.com/MatheusBBarni/Kitten",
      );
    },
  );

  test("ignores incomplete or previously started controls", async () => {
    const incomplete = createControl({}, false);
    const started = createControl({ starRequestStarted: "true" });
    let calls = 0;
    const fetcher: Fetcher = async () => {
      calls += 1;
      return Response.json({ stargazers_count: 1 });
    };

    expect(await bindStarCountControls(incomplete.root, { fetcher })).toEqual(
      [],
    );
    expect(await bindStarCountControls(started.root, { fetcher })).toEqual([]);
    expect(calls).toBe(0);
  });
});
