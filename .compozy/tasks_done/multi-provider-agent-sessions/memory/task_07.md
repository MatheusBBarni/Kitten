# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Surface each session's title + cwd in the approval overlay and status strip so a permission decision can never land in the wrong repo when several agents (esp. two of the same provider) run at once. Identity was already attached to the overlay in task_03; task_07 only renders it.

## Important Decisions
- **ApprovalPrompt**: kept the frame border title as the provider `displayName` (existing tests depend on `approvalTitleFor("Claude Code")`), and added a new identity line (session `title` + full `cwd`) as the first child inside the box. Full path shown, not basename - basenames collide across clones.
- **StatusStrip chip**: switched the chip label from `runtime.displayName` to `runtime.title`. Same-provider sessions share a displayName; title (defaults to cwd basename) disambiguates. Did NOT add cwd to the strip: the 80-col single-row layout is a guarded invariant (StatusStrip.test "fits ... into 80 columns"), so the absolute-directory disambiguation lives in the Ctrl+S overview and the approval prompt, where a decision actually lands.
- **SessionsOverlay/overview**: already renders title+provider+cwd per SessionCard - no change needed. Coverage already exists (SessionsOverlay.test "renders one card per session ... with its title, provider, directory, and state" over a 2-same-provider fleet).
- **7.4 (no cross-session auto-approve)**: no code change - the controller's single-slot FIFO queue (`enqueuePermission`/`resolvePermission`, `pending.shift()`) already settles only the head request per session. Added tests to lock it.

## Learnings
- Changing the strip label from displayName->title broke two HandoffTargetPicker tests that used bare `not.toContain("Alpha")`/`not.toContain("Gamma")` as a proxy for "source excluded from picker list": the source's title now shows in the strip. Fixed by asserting on the source's directory (`/work/alpha`, `/work/gamma`) instead - the picker card shows cwd, the strip does not.
- In an integration test with two same-provider sessions, `createConnection(config)` gets `config.id === providerKind` for both (spawn id is the kind), so you cannot map by id - hand out fresh connections via a shift-queue in plan order (declared order).
- `resolveSessions` probes declared-session cwds with `existsSync`, so an integration test with a declared `sessions` list must use real directories (used repo `src`/`test`).

## Files / Surfaces
- `src/ui/ApprovalPrompt.tsx` - identity line (title + cwd); destructure title/cwd from overlay; module-comment note.
- `src/ui/StatusStrip.tsx` - chip label displayName -> title; comment.
- `src/ui/ApprovalPrompt.test.tsx` - 2 UI unit tests (header shows title+cwd; two same-provider distinct headers) + 1 UI integration test (two same-provider sessions, per-session naming + routing + no cross-session auto-approve).
- `src/app/controller.test.ts` - 1 unit test (answering one same-provider session settles only it; sibling stays queued).
- `src/ui/HandoffTargetPicker.test.tsx` - retargeted 2 assertions from source title to source directory.

## Errors / Corrections
- None outstanding. Full gate green: typecheck clean, `bun test` 554 pass / 0 fail, `bun run selfcheck` SELF-CHECK OK.

## Ready for Next Run
- task_07 complete. Approval + strip now labeled per session; overview already was.
