import matrixDocument from "./lifecycle-matrix.v1.json";

export type NativeWindowName = "wide" | "medium" | "narrow";
export type NativeTheme = "light" | "dark";
export type NativeMotion = "standard" | "reduced";
export type NativeDriverAction = "submit_direction" | "submit_request_changes";
export type NativeDriverView =
  | "board"
  | "workbench"
  | "review"
  | "request_changes"
  | "approve_stale"
  | "board_return"
  | "settings"
  | "settings_return";

export interface NativeLifecycleDriver {
  readonly view: NativeDriverView;
  readonly cardId?: string;
  readonly fileId?: string;
  readonly focusTargetId?: string;
  readonly action?: NativeDriverAction;
  readonly text?: string;
  readonly expectText?: string;
}

export interface NativeLifecycleMatrixEntry {
  readonly fixtureId: string;
  readonly state: string;
  readonly window: NativeWindowName;
  readonly theme: NativeTheme;
  readonly motion: NativeMotion;
  readonly driver: NativeLifecycleDriver;
}

export interface NativeLifecycleMatrix {
  readonly schemaVersion: 1;
  readonly matrixVersion: string;
  readonly artifactMaxAgeMinutes: number;
  readonly windows: Readonly<Record<NativeWindowName, {
    readonly width: number;
    readonly height: number;
  }>>;
  readonly entries: readonly NativeLifecycleMatrixEntry[];
}

const WINDOW_NAMES = ["wide", "medium", "narrow"] as const;
const THEMES = ["light", "dark"] as const;
const MOTIONS = ["standard", "reduced"] as const;
const DRIVER_ACTIONS = ["submit_direction", "submit_request_changes"] as const;
const DRIVER_VIEWS = [
  "board",
  "workbench",
  "review",
  "request_changes",
  "approve_stale",
  "board_return",
  "settings",
  "settings_return",
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function oneOf<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${label} is unsupported`);
  }
  return value as T;
}

function parseDriver(value: unknown, index: number): NativeLifecycleDriver {
  const driver = record(value, `matrix entry ${index} driver`);
  const optionalString = (key: string): string | undefined => (
    driver[key] === undefined ? undefined : nonEmpty(driver[key], `driver ${key}`)
  );
  const action = driver.action === undefined
    ? undefined
    : oneOf(driver.action, DRIVER_ACTIONS, "driver action");
  const text = optionalString("text");
  const expectText = optionalString("expectText");
  if (action !== undefined && (text === undefined || expectText === undefined)) {
    throw new Error("driver action requires text and expectText");
  }
  return {
    view: oneOf(driver.view, DRIVER_VIEWS, "driver view"),
    ...(optionalString("cardId") === undefined ? {} : { cardId: optionalString("cardId") }),
    ...(optionalString("fileId") === undefined ? {} : { fileId: optionalString("fileId") }),
    ...(optionalString("focusTargetId") === undefined
      ? {}
      : { focusTargetId: optionalString("focusTargetId") }),
    ...(action === undefined ? {} : { action }),
    ...(text === undefined ? {} : { text }),
    ...(expectText === undefined ? {} : { expectText }),
  };
}

export function parseLifecycleMatrix(value: unknown): NativeLifecycleMatrix {
  const matrix = record(value, "lifecycle matrix");
  if (matrix.schemaVersion !== 1) throw new Error("lifecycle matrix schemaVersion must be 1");
  if (!Array.isArray(matrix.entries) || matrix.entries.length === 0) {
    throw new Error("lifecycle matrix entries must be non-empty");
  }
  const windowInput = record(matrix.windows, "lifecycle matrix windows");
  const windows = Object.fromEntries(WINDOW_NAMES.map((name) => {
    const dimensions = record(windowInput[name], `${name} window`);
    return [name, {
      width: positiveInteger(dimensions.width, `${name} window width`),
      height: positiveInteger(dimensions.height, `${name} window height`),
    }];
  })) as NativeLifecycleMatrix["windows"];
  const entries = matrix.entries.map((input, index): NativeLifecycleMatrixEntry => {
    const entry = record(input, `matrix entry ${index}`);
    return {
      fixtureId: nonEmpty(entry.fixtureId, `matrix entry ${index} fixtureId`),
      state: nonEmpty(entry.state, `matrix entry ${index} state`),
      window: oneOf(entry.window, WINDOW_NAMES, `matrix entry ${index} window`),
      theme: oneOf(entry.theme, THEMES, `matrix entry ${index} theme`),
      motion: oneOf(entry.motion, MOTIONS, `matrix entry ${index} motion`),
      driver: parseDriver(entry.driver, index),
    };
  });
  const fixtureIds = entries.map(({ fixtureId }) => fixtureId);
  const states = entries.map(({ state }) => state);
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new Error("every lifecycle matrix entry must have a unique fixtureId");
  }
  if (new Set(states).size !== states.length) {
    throw new Error("every lifecycle matrix entry must have a unique state");
  }
  return Object.freeze({
    schemaVersion: 1,
    matrixVersion: nonEmpty(matrix.matrixVersion, "matrixVersion"),
    artifactMaxAgeMinutes: positiveInteger(
      matrix.artifactMaxAgeMinutes,
      "artifactMaxAgeMinutes",
    ),
    windows: Object.freeze(windows),
    entries: Object.freeze(entries),
  });
}

export const lifecycleMatrix = parseLifecycleMatrix(matrixDocument);

export function declaredLifecycleFixture(fixtureId: string): NativeLifecycleMatrixEntry {
  const fixture = lifecycleMatrix.entries.find((entry) => entry.fixtureId === fixtureId);
  if (fixture === undefined) throw new Error(`Unsupported lifecycle fixture: ${fixtureId}`);
  return fixture;
}
