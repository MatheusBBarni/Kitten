import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  declaredLifecycleFixture,
  lifecycleMatrix,
  type NativeLifecycleMatrixEntry,
} from "./lifecycleMatrix.ts";

export const NATIVE_CAPTURE_ENV = {
  enabled: "KITTEN_NATIVE_CAPTURE",
  target: "KITTEN_NATIVE_CAPTURE_TARGET",
  fixtureId: "KITTEN_NATIVE_FIXTURE_ID",
  databasePath: "KITTEN_NATIVE_FIXTURE_DATABASE",
  readyPath: "KITTEN_NATIVE_CAPTURE_READY",
  matrixVersion: "KITTEN_NATIVE_MATRIX_VERSION",
} as const;

export interface NativeCaptureRuntime {
  readonly matrixVersion: string;
  readonly fixture: NativeLifecycleMatrixEntry;
  readonly databasePath: string;
  readonly readyPath: string;
  readonly window: { readonly width: number; readonly height: number };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Native capture environment is missing ${key}`);
  }
  return value;
}

export function resolveNativeCaptureRuntime(
  env: NodeJS.ProcessEnv,
): NativeCaptureRuntime | null {
  if (env[NATIVE_CAPTURE_ENV.enabled] === undefined) return null;
  if (env[NATIVE_CAPTURE_ENV.enabled] !== "1") {
    throw new Error("Native capture mode must be explicitly enabled with value 1");
  }
  if (required(env, NATIVE_CAPTURE_ENV.target) !== "packaged") {
    throw new Error("Native lifecycle capture rejects browser and dev-server targets");
  }
  const fixtureId = required(env, NATIVE_CAPTURE_ENV.fixtureId);
  const fixture = declaredLifecycleFixture(fixtureId);
  const matrixVersion = required(env, NATIVE_CAPTURE_ENV.matrixVersion);
  if (matrixVersion !== lifecycleMatrix.matrixVersion) {
    throw new Error("Native capture matrix version does not match the packaged declaration");
  }
  const databasePath = resolve(required(env, NATIVE_CAPTURE_ENV.databasePath));
  const readyPath = resolve(required(env, NATIVE_CAPTURE_ENV.readyPath));
  if (!isAbsolute(databasePath) || !existsSync(databasePath)) {
    throw new Error("Native capture database must be an existing absolute path");
  }
  const fixtureDirectory = dirname(databasePath);
  if (!readyPath.startsWith(`${fixtureDirectory}/`)) {
    throw new Error("Native capture readiness file must stay inside the fixture directory");
  }
  const descriptorPath = resolve(fixtureDirectory, "fixture.json");
  if (!existsSync(descriptorPath)) {
    throw new Error("Native capture fixture descriptor is missing");
  }
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8")) as {
    readonly matrixVersion?: unknown;
    readonly fixtureId?: unknown;
  };
  if (
    descriptor.matrixVersion !== lifecycleMatrix.matrixVersion
    || descriptor.fixtureId !== fixture.fixtureId
  ) {
    throw new Error("Native capture fixture descriptor does not match the declared fixture");
  }
  return {
    matrixVersion,
    fixture,
    databasePath,
    readyPath,
    window: lifecycleMatrix.windows[fixture.window],
  };
}

function queryByText(label: string): string {
  return `findButton(${JSON.stringify(label)})`;
}

function selectionScript(fixture: NativeLifecycleMatrixEntry): string {
  const driver = fixture.driver;
  const cardClick = driver.cardId === undefined
    ? ""
    : `await clickWhen(() => document.querySelector(${JSON.stringify(
        `[data-desktop-card-id="${driver.cardId}"]`,
      )}), "card ${driver.cardId}");`;
  const openReview = (
    driver.view === "review"
    || driver.view === "request_changes"
    || driver.view === "approve_stale"
  )
    ? "await clickWhen(() => document.querySelector('[data-desktop-command-target=\"open-review\"]'), \"Open review\");"
    : "";
  const selectFile = driver.fileId === undefined
    ? ""
    : `await clickWhen(() => document.querySelector(${JSON.stringify(
        `[data-native-file-id="${driver.fileId}"]`,
      )}), "review file ${driver.fileId}");`;
  const routeAction = driver.view === "settings"
    ? `await clickWhen(() => ${queryByText("Settings")}, "Settings");`
    : driver.view === "settings_return"
      ? `${cardClick} await clickWhen(() => ${queryByText("Settings")}, "Settings"); await clickWhen(() => ${queryByText("Board")}, "Board");`
      : driver.view === "request_changes"
        ? `${cardClick} ${openReview} ${selectFile} await clickWhen(() => ${queryByText("Request changes")}, "Request changes");`
        : driver.view === "approve_stale"
          ? `${cardClick} ${openReview} ${selectFile} await clickWhen(() => ${queryByText("Approve")}, "Approve"); await waitFor(() => document.querySelector('[role="alert"]'), "stale evidence alert");`
          : driver.view === "board_return"
            ? `${cardClick} await clickWhen(() => document.getElementById("workbench-close-trigger") ?? document.getElementById("workbench-back-trigger"), "workbench return");`
            : `${cardClick} ${openReview} ${selectFile}`;
  const focus = driver.focusTargetId === undefined
    ? ""
    : `await waitFor(() => document.getElementById(${JSON.stringify(
        driver.focusTargetId,
      )}), "focus target").then((element) => element.focus());`;
  const submit = driver.action === undefined
    ? ""
    : `{
        const composer = await waitFor(
          () => document.getElementById("card-composer-draft"),
          "card composer"
        );
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )?.set;
        if (setValue === undefined) throw new Error("textarea value setter unavailable");
        setValue.call(composer, ${JSON.stringify(driver.text)});
        composer.dispatchEvent(new Event("input", { bubbles: true }));
        composer.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true
        }));
        await waitFor(
          () => document.body.textContent?.includes(${JSON.stringify(driver.expectText)}),
          ${JSON.stringify(`${driver.action} postcondition`)}
        );
      }`;
  return `${routeAction} ${focus} ${submit}`;
}

export function buildNativeCaptureDriverScript(runtime: NativeCaptureRuntime): string {
  const { fixture } = runtime;
  return `void (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (find, label) => {
      for (let count = 0; count < 80; count += 1) {
        const value = find();
        if (value) return value;
        await sleep(50);
      }
      throw new Error("Native capture target unavailable: " + label);
    };
    const clickWhen = async (find, label) => {
      const element = await waitFor(find, label);
      element.click();
      await sleep(150);
      return element;
    };
    const findButton = (label) => [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.replace(/\\s+/g, " ").trim().startsWith(label));
    try {
      document.documentElement.dataset.theme = ${JSON.stringify(fixture.theme)};
      document.documentElement.style.colorScheme = ${JSON.stringify(fixture.theme)};
      document.documentElement.dataset.motion = ${JSON.stringify(fixture.motion)};
      if (${JSON.stringify(fixture.motion)} === "reduced") {
        const style = document.createElement("style");
        style.dataset.nativeCapture = "reduced-motion";
        style.textContent = "*,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;scroll-behavior:auto!important}";
        document.head.append(style);
      }
      await waitFor(() => document.querySelector("[data-shell-layout], .settings-shell"), "desktop shell");
      ${selectionScript(fixture)}
      await sleep(250);
      document.documentElement.dataset.nativeCaptureState = ${JSON.stringify(fixture.state)};
      await window.__kittenReportNativeCaptureReady?.({
        fixtureId: ${JSON.stringify(fixture.fixtureId)},
        state: ${JSON.stringify(fixture.state)},
        result: "ready"
      });
    } catch (error) {
      await window.__kittenReportNativeCaptureReady?.({
        fixtureId: ${JSON.stringify(fixture.fixtureId)},
        state: ${JSON.stringify(fixture.state)},
        result: "failed",
        reason: error instanceof Error ? error.message : "native capture driver failed"
      });
    }
  })();`;
}

declare global {
  interface Window {
    __kittenReportNativeCaptureReady?: (
      input: {
        readonly fixtureId: string;
        readonly state: string;
        readonly result: "ready" | "failed";
        readonly reason?: string;
      },
    ) => Promise<unknown>;
  }
}
