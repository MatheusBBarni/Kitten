# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Make `SessionController` own one shell runtime from boot through teardown, wire its semantic events into the store, and keep agent startup independent of shell availability.

## Important Decisions

- Expose shell availability as a discriminated controller-owned state containing either the `ShellRuntime` boundary or a startup error. The immutable store continues to hold only reduced `ShellEvent` state and never the emulator/runtime.
- Use the controller launch `cwd` for the single shell. This is the same directory used by zero-config agent sessions and avoids choosing arbitrarily among explicitly configured per-session directories.
- Extend the existing controller unit suite and real shell integration suite rather than creating another test file.

## Learnings

- The completed store/runtime dependencies already provide `applyShellEvent`, `ShellRuntimeFactory`, a real `createShellRuntime`, and an observable in-memory factory.
- The shared workflow warning applies: real-controller integration will wrap the production factory with a `/bin/sh` command override so workstation zsh startup cannot block on an SSH-key prompt.
- The real controller integration needs explicit OSC markers under `/bin/sh` to exercise semantic command records; the test wraps a real `echo` command and separately verifies the PTY shell PID is gone after controller disposal.
- Targeted controller coverage is 97.30% functions and 99.48% lines. Full-suite coverage is 97.13% functions and 98.50% lines.

## Files / Surfaces

- Implemented: `src/app/controller.ts`, `src/app/controller.test.ts`, `src/index.ts`, `test/shellRuntime.integration.test.ts`, `test/fakeController.ts`, plus shell-state additions to the controller doubles in `test/cockpitSession.test.ts`, `test/configPersistence.integration.test.ts`, and `test/telemetry.integration.test.ts`.

## Errors / Corrections

- Pre-change signal: `src/app/controller.ts` contains no shell runtime import, factory seam, event subscription, controller exposure, or disposal path.
- The first real-shell cwd assertion timed out because macOS canonicalized `/var/folders` to `/private/var/folders`; production state was correct, and the test oracle now uses `realpathSync`.
- Final gate is warning-blocked despite zero failures: `bun test` reports the existing React act warning, repeated OpenTUI `theme_mode` listener warnings, and a TreeSitter-destroyed warning; self-check also reports the React act warning. Per `cy-final-verify`, task tracking remains pending and no commit was created.

## Ready for Next Run

- Implementation self-review found no task-scope defect. After the repository warning noise is resolved, rerun typecheck, full tests, coverage, and self-check; only then mark task checkboxes/status complete and create the automatic local commit.
