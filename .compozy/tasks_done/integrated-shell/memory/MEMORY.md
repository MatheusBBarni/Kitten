# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- On this workstation, the default `$SHELL` zsh startup can block on an SSH-key passphrase prompt. Real-shell integration tests should use the runtime's `/bin/sh` command override for determinism; production still defaults to `$SHELL`.
- On macOS, a shell started in a temp directory under `/var/folders` reports the canonical `/private/var/folders` path through `$PWD`/OSC 7. Real-shell tests should compare against `realpathSync(cwd)`.
- With Bun 1.3.13, passing a preconstructed reusable `Bun.Terminal` to `Bun.spawn` leaves interactive shells without a controlling terminal/job control, so `0x03` cannot interrupt the foreground process. Pass terminal options directly to `Bun.spawn` and use `proc.terminal` so Bun establishes the session and foreground process group.
- On Bun 1.3.13, repository-wide `bun test` (with or without coverage) can segfault under default concurrency during warning-heavy OpenTUI tests; `--max-concurrency 1` completes deterministically, and coverage mode still enforces the configured threshold.

## Open Risks

- The repository-wide test gate currently exits green but emits React `act(...)`, OpenTUI `theme_mode` listener-limit, and TreeSitter-destroyed warnings. `cy-final-verify` requires a warning-clean gate, so integrated-shell tasks must remain pending and uncommitted until this baseline is cleaned.

## Handoffs
