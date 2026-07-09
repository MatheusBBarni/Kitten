# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Pure, deterministic `BundleAssembler` + `SecretRedactor` in `src/core`. Done: all 6 unit cases + the integration case from the task file pass; typecheck clean; coverage exits 0.

## Important Decisions
- Exported `createDeterministicAssembler()` factory rather than a `DeterministicAssembler` class. The task file names the class, but every other module in this repo is a factory (`createAgentConnection`, `createAppStore`, `createSessionState`). Repo convention won; the `BundleAssembler` interface is what task_12 depends on, and it matches the techspec exactly.
- Redaction runs **per turn, before truncation**. Truncating first could cut a credential in half and leave a prefix that no pattern matches, i.e. an unredacted leak.
- `redactionCount` counts only secrets in turns that survived the excerpt bound, plus all diff secrets. The number describes the bundle the developer is actually previewing, not the whole transcript.
- Excerpt is built newest-first until the char budget is spent, then reversed. A turn is included whole or dropped whole (never split), and drops are announced via `[N earlier turn(s) omitted]`.
- `OMISSION_NOTICE_RESERVE = 48` chars is carved out of `maxSummaryChars` up front so the final summary honours the cap exactly. A trailing `.slice(0, maxSummaryChars)` makes the bound unconditional even for absurd caller limits.
- Redactor bias is **false negatives over false positives** (techspec "Known Risks"): the human preview is the mandatory second line. Hence the generic `key = value` pattern requires the value to contain a digit, keeping prose like `the token: something-descriptive` out of the net.

## Learnings
- `String.prototype.replace` with a global regex resets `lastIndex` itself, so a compiled pattern is safe to share across calls. Cloning the RegExp per line was dead defense. But a caller-supplied **non-global** pattern would only redact the first match per line, so `createSecretRedactor` normalizes every pattern to `g` once at construction.
- In `replace`'s callback the last argument is the named-groups object **only if the pattern declares named groups**; otherwise it is the full input string. A `typeof x === "object"` check distinguishes them reliably.
- An optional regex prefix group backtracks. `/^([+\- ]?)(\S.*)$/` on the diff line `"+   "` gives up the `+` to group 1 and captures `"+   "` in group 2, so the marker gets eaten by the placeholder. Take a unified-diff prefix positionally (`"+- ".includes(line[0])`), not with an optional group.
- A *removed* PEM line in a diff reads `------BEGIN PRIVATE KEY-----` (6 dashes: the `-` marker plus the marker's own 5). The `[+\- ]?` prefix in `PEM_BEGIN`/`PEM_END` handles it.
- Google API keys are `AIza` + exactly 35 chars (39 total). A 40-char fixture silently fails the `\b`-anchored `{35}` pattern.
- Bun coverage still reports the `default: return assertNever(...)` arm as uncovered (`bundleAssembler.ts:196,198`, same as `sessionReducer.ts:62`). It is a compile-time exhaustiveness guard, unreachable at runtime. Both files stay well above the 0.8 per-file threshold.

## Files / Surfaces
- new `src/core/secretRedactor.ts`, `src/core/bundleAssembler.ts` (+ their `.test.ts`)
- no existing file modified

## Errors / Corrections
- Caught in self-review, before commit: the PEM-body backtracking bug (would corrupt a hunk, the exact failure mode the task forbids) and the pointless per-line RegExp clone masking the non-global-pattern gap. Both fixed with regression tests.

## Ready for Next Run
task_12 (`src/app/handoff.ts`) consumes `createDeterministicAssembler().assemble(session, target)`. Redaction is already applied inside `assemble` - do NOT redact again downstream or `redactionCount` will double-count. Diff `path` and `toolCallId` are never redacted, only `unified` text.
