export type StarStatus = "loading" | "ready" | "unavailable";

export type StarState = {
  readonly status: StarStatus;
  readonly text: string;
  readonly accessibleLabel: string;
};

export type StarCopy = {
  readonly repositoryName: string;
  readonly loadingText: string;
  readonly loadingAccessibleLabel: string;
  readonly fallbackText: string;
  readonly fallbackAccessibleLabel: string;
};

export type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type BindDependencies = {
  readonly fetcher: Fetcher;
};

const controlSelector = "[data-star-control]";
const statusTextSelector = "[data-star-status-text]";
const numberFormatter = new Intl.NumberFormat("en-US");

export function parseStarCount(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const count = Reflect.get(payload, "stargazers_count");
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
}

export function mapStarState(
  status: StarStatus,
  copy: StarCopy,
  stars: number | null = null,
): StarState {
  if (status === "ready" && stars !== null) {
    const formattedCount = numberFormatter.format(stars);
    const noun = stars === 1 ? "star" : "stars";

    return {
      status,
      text: formattedCount,
      accessibleLabel: `Star ${copy.repositoryName} on GitHub. ${formattedCount} ${noun}.`,
    };
  }

  if (status === "loading") {
    return {
      status,
      text: copy.loadingText,
      accessibleLabel: copy.loadingAccessibleLabel,
    };
  }

  return {
    status: "unavailable",
    text: copy.fallbackText,
    accessibleLabel: copy.fallbackAccessibleLabel,
  };
}

export function githubRepositoryEndpoint(owner: string, repo: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export async function fetchRepositoryStarCount(
  owner: string,
  repo: string,
  fetcher: Fetcher = fetch,
): Promise<number | null> {
  if (!owner.trim() || !repo.trim()) {
    return null;
  }

  try {
    const response = await fetcher(githubRepositoryEndpoint(owner, repo), {
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });

    if (!response.ok) {
      return null;
    }

    return parseStarCount(await response.json());
  } catch {
    return null;
  }
}

export function renderStarState(
  control: HTMLElement,
  statusElement: HTMLElement,
  state: StarState,
): void {
  control.dataset.starStatus = state.status;
  control.setAttribute("aria-label", state.accessibleLabel);
  statusElement.textContent = state.text;
}

function starCopyFrom(control: HTMLElement): StarCopy | null {
  const {
    repoName,
    starLoadingText,
    starLoadingLabel,
    starFallbackText,
    starFallbackLabel,
  } = control.dataset;

  if (
    !repoName ||
    !starLoadingText ||
    !starLoadingLabel ||
    !starFallbackText ||
    !starFallbackLabel
  ) {
    return null;
  }

  return {
    repositoryName: repoName,
    loadingText: starLoadingText,
    loadingAccessibleLabel: starLoadingLabel,
    fallbackText: starFallbackText,
    fallbackAccessibleLabel: starFallbackLabel,
  };
}

async function loadStarControl(
  control: HTMLElement,
  statusElement: HTMLElement,
  copy: StarCopy,
  fetcher: Fetcher,
): Promise<StarState> {
  renderStarState(control, statusElement, mapStarState("loading", copy));

  const stars = await fetchRepositoryStarCount(
    control.dataset.repoOwner ?? "",
    control.dataset.repoName ?? "",
    fetcher,
  );
  const state =
    stars === null
      ? mapStarState("unavailable", copy)
      : mapStarState("ready", copy, stars);

  renderStarState(control, statusElement, state);
  return state;
}

export async function bindStarCountControls(
  root: ParentNode,
  dependencies: BindDependencies = { fetcher: fetch },
): Promise<readonly StarState[]> {
  const pending: Promise<StarState>[] = [];

  for (const control of root.querySelectorAll<HTMLElement>(controlSelector)) {
    if (control.dataset.starRequestStarted === "true") {
      continue;
    }

    const statusElement =
      control.querySelector<HTMLElement>(statusTextSelector);
    const copy = starCopyFrom(control);
    if (!statusElement || !copy) {
      continue;
    }

    control.dataset.starRequestStarted = "true";
    pending.push(loadStarControl(control, statusElement, copy, dependencies.fetcher));
  }

  return Promise.all(pending);
}

if (typeof document !== "undefined") {
  void bindStarCountControls(document);
}
