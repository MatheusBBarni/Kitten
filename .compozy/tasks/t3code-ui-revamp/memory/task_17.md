# Task Memory: task_17.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build and execute a deterministic packaged Electrobun lifecycle capture
  harness. Automated tests or browser screenshots cannot satisfy completion;
  every declared matrix state needs reviewed native evidence unless the product
  owner explicitly waives named states with reasons.

## Important Decisions

- Keep the matrix authoritative and versioned under
  `packages/desktop/test/native`; fixture selection must be explicit and must
  not alter production defaults.
- Native mode is enabled only by the `KITTEN_NATIVE_CAPTURE*` environment
  contract, rejects any target other than `packaged`, resolves a declared
  fixture descriptor, and redirects database, home/config, measurement, and
  repository state into the synthetic fixture directory.
- Drive the packaged renderer from Electrobun's `dom-ready` event and
  `BrowserView.executeJavascript`, report semantic readiness over the desktop
  RPC boundary, then capture the fixed native window region with macOS
  `screencapture`. Automated injected-capture tests remain runner evidence,
  never native visual proof.
- Hash and extract the stable packaged `.app.tar.zst` into the runner-owned
  temporary root, then launch its bundled Bun runtime and packaged `main.js`
  directly. This preserves packaged bytes while keeping the long-lived app
  process inside the cleanup registry; Electrobun's top-level launcher is a
  short-lived self-extractor that otherwise orphans the real process.
- Pin synthetic Git author and committer identity and timestamps so repeated
  fixture seeding produces identical commit identities and SQLite projections.
- Preserve the extensive pre-existing Task 01-16 working-tree changes and keep
  Task 17 edits narrowly attributable.

## Learnings

- Pre-change baseline: `packages/desktop/test/native` and native lifecycle
  package commands do not exist.
- The packet contains no `_user_stories.md` or `_tests.md`; the PRD, TechSpec,
  task file, `_tasks.md`, and ADR-001 through ADR-006 are the available
  contracts.
- Electrobun 1.18.1 exposes packaged builds, `BrowserWindow` frame sizing,
  `BrowserView` `dom-ready`, and `executeJavascript`, but no documented native
  screenshot API. The runner therefore uses the packaged window plus the
  operating-system capture command.
- Journal fixture writes must preserve projection sequencing: review evidence
  event IDs are `evidence:<evidenceId>`, and interrupted follow-up queues must
  be persisted as versioned enqueued, dispatching, then interrupted events.
- Focused verification is green: 17 native harness tests, the Electrobun host
  handshake tests, the configuration test, governed smoke drift test, and
  TypeScript. Fresh full coverage ran 380 tests with zero failures and reports
  93.23% aggregate line coverage. Task 17 harness lines are matrix 94.79%,
  runtime 90.00%, runner 95.13%, and seeder 91.01%.
- The stable packaged build succeeds and the extracted packaged app reaches
  the fixture/state readiness handshake. Native region capture then fails with
  `could not create image from rect`. The machine reports its only online
  built-in display as `Display Asleep: Yes`; full-screen capture is black and
  ScreenCaptureKit reports an audio/video capture start failure. The app and
  capture children are absent after failure.

## Files / Surfaces

- Added/changed: `test/native/lifecycle-matrix.v1.json`,
  `lifecycleMatrix.ts`, `seedLifecycleFixture.ts`,
  `nativeCaptureRuntime.ts`, `runLifecycleCapture.ts`, and
  `lifecycleCapture.test.ts`; desktop package scripts and Electrobun resources;
  packaged host/runtime selection and readiness RPC; renderer driver bridge
  and review-file selectors; oversized evidence fail-closed behavior;
  Electrobun/config tests; governed desktop smoke matrix drift check.

## Errors / Corrections

- Run desktop scripts from `packages/desktop` as `rtk bun run <script>`; do not
  use the misleading `rtk bun --cwd packages/desktop ...` form.
- Initial fixture validation exposed an invalid review evidence event ID, a
  version-3 follow-up queue inserted without versions 1 and 2, and unpinned
  Git commit timestamps. Corrected the fixture builder rather than weakening
  assertions.
- A focused coverage invocation still exits non-zero because it imports broad
  production surfaces without their normal tests; use the full repository
  coverage gate for the authoritative overall result. The new harness files'
  individual line coverage is at or above 80%.
- The full coverage command also exits non-zero despite 380 passing tests and
  93.23% aggregate lines because inherited per-file thresholds remain below
  80% in `desktopCoordinator.ts`, `workflowApiServer.ts`, `main.ts`,
  `StageSetupModal.tsx`, `WorkflowBoard.tsx`,
  `WorkflowBoardContainer.tsx`, `useWorkflowBoardController.ts`,
  `TaskEditModal.tsx`, and renderer `main.tsx`. Do not broaden Task 17 into
  those unrelated Task 01-16 surfaces.
- A freshly built stable bundle contains only the self-extracting launcher at
  its installed build path. The complete app runtime is present in the stable
  `.app.tar.zst`; extract that artifact into temporary runner ownership before
  resolving `Contents/MacOS/bun` and `Contents/Resources/main.js`.

## Current Gate / Next Run

- Task 17 remains incomplete. No default `lifecycle-v1` manifest or reviewed
  packaged screenshots exist, and `native:verify` correctly fails for the
  missing manifest.
- Re-run the real matrix from a session with an awake, capturable display, then
  inspect every artifact and record pass/fail review notes. Alternatively, the
  product owner must explicitly waive enumerated states with reasons. Do not
  update task/master tracking or create the automatic commit before one of
  those native evidence paths is satisfied and the repository gate is clean.
