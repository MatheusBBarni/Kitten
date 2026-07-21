# Kitten

This context defines the user-facing concepts shared by Kitten's interactive agent work, governed unattended execution, and portable context workflows.

## Language

### Product Family

**Kitten Cockpit**:
The terminal application for developer-led live agent sessions, steering, delegation, and hand-off.
_Avoid_: Kitten Orchestrator, desktop mode

**Kitten Orchestrator**:
The planned Kitten product for governing unattended coding-agent tasks from discovery through isolated execution, verification, and review.
_Avoid_: Task Orchestrator, sibling repository

**Grok Build**:
xAI's terminal coding agent and CLI, which can run interactive, headless, or ACP sessions.
_Avoid_: Grok API, generic xAI model

**Grok Build ACP Profile**:
The exact Grok Build npx package release and credential-free launch recipe that an operator explicitly configures and Kitten verifies before opening an ACP session through Kitten's approval flow.
_Avoid_: Generic Grok adapter, unverified Grok configuration

**Uncertified Grok Build Session**:
A Grok Build ACP session launched from a user-modified recipe that may use only generic ACP behavior and has no provider-specific capability claim.
_Avoid_: Certified profile, full Grok Build parity

**Task Orchestrator**:
The predecessor product whose capabilities are migrated into Kitten Orchestrator before the predecessor is retired.
_Avoid_: Permanent companion app, long-lived fork

**Shared Capability**:
A reusable agent, session, context, or policy building block that does not own either application's workflow or user interface.
_Avoid_: Universal engine, shared app controller

**Orchestrated Work**:
The durable lifecycle that carries one queued task through isolated attempts, verification, review, and final disposition.
_Avoid_: Run, session, queue row

**Run Attempt**:
One agent session that acts on an Orchestrated Work's shared worktree using one exact Run Context.
_Avoid_: Retry of hidden session state, entire task lifecycle

**Attention Blocker**:
A bounded task or domain clarification that pauses a Run Attempt until the developer answers or the request settles safely.
_Avoid_: Permission prompt, arbitrary agent question

**Run Context**:
The immutable, auditable input assembled automatically for one Run Attempt from trusted task, repository, and prior-review evidence.
_Avoid_: Context Pack, hidden prompt, agent-generated plan

**Execution Route**:
The selected runtime path for a Run Attempt: a certified direct ACP profile or the Compozy workflow.
_Avoid_: Task source, model, provider-specific SDK

**Direct ACP Route**:
An Execution Route in which Kitten Orchestrator directly hosts a certified Claude, Codex, Cursor, or opt-in Grok Build ACP session.
_Avoid_: Claude Agent SDK, generic ACP compatibility

**Compozy Route**:
An Execution Route in which Kitten Orchestrator delegates the task workflow to the Compozy CLI while retaining host governance.
_Avoid_: ACP provider profile, ungoverned subprocess

**Cross-App Handoff**:
An explicitly reviewed transfer of task, workspace, context, transcript, and evidence into a new session owned by the other Kitten application.
_Avoid_: Live session transfer, shared session control

**Agent Profile Registry**:
The versioned user-level configuration that both Kitten applications use to resolve certified agent launch recipes and readiness.
_Avoid_: Shared application database, provider credential store

**Predecessor Import**:
The explicit, idempotent copy of Task Orchestrator data into Kitten Orchestrator-owned storage while leaving the source untouched.
_Avoid_: In-place database upgrade, silent migration

### Cockpit Personalization

**Theme Preset**:
A named, curated visual palette from a public upstream source that a Kitten Cockpit user can select and keep, faithful to its recognizable source with only necessary readability adjustments and a stable identity across catalog changes.
_Avoid_: Custom theme, imported theme

**Theme Family**:
A recognizable external theme lineage whose official variants Kitten curates as Theme Presets.
_Avoid_: Unrelated color collection, arbitrary user palette

**Curated Theme Catalog**:
The finite, currently 18-preset set of Theme Families and their Theme Presets that Kitten ships alongside Auto, Light, and Dark selection; its canonical identity and provenance contract is the [Theme Catalog](docs/theme-catalog.md).
_Avoid_: Theme marketplace, arbitrary palette collection

**Theme Preference**:
The user's persistent choice of Auto, Light, Dark, or one Theme Preset.
_Avoid_: Terminal theme mode, temporary preview

### Cockpit Session Control

**Hard Stop**:
A developer's explicit request to cancel the active Cockpit turn while retaining its ACP session.
_Avoid_: Session reset, steering, conversation close

**Post-Interrupt Continuation**:
One developer message held after a Hard Stop and sent as the next ordinary turn once the interrupted turn settles in the same healthy Cockpit session.
_Avoid_: Steering follow-up, automatic retry

### Context Engineering

**Context Pack**:
A reviewable, session-owned collection of task instructions and curated workspace material prepared for an agent.
_Avoid_: Explore result, enhanced hand-off bundle, context window

**Draft Context Pack**:
A mutable Context Pack that is still being curated and cannot be sent to an agent.
_Avoid_: Live pack, sendable selection

**Sealed Context Pack**:
An immutable Context Pack whose exact prompt and workspace material have passed explicit human review.
_Avoid_: Live manifest, approved paths

**Full File Item**:
The exact text of one Workspace Entry included as a complete Context Pack item.
_Avoid_: File reference, attachment

**File Slice**:
A contiguous line range from one Workspace Entry paired with a concise explanation of its relevance.
_Avoid_: Snippet, arbitrary excerpt

**Diff Item**:
A bounded patch from the Session Workspace included as one Context Pack item.
_Avoid_: Change summary, whole repository diff

**Context Pack Curation**:
The revision of a Draft Context Pack's task instructions, material, and relevance explanations.
_Avoid_: Workspace editing, pack sending

**Context Pack Capability**:
The scoped authority that lets an active `explore` child curate its parent's Draft Context Pack and inspect its budget state.
_Avoid_: External MCP access, file-write access, sealing authority

**Context Pack Review**:
The explicit inspection of a Draft Context Pack's instructions, material, relevance explanations, and budget before it is sealed.
_Avoid_: Hand-off preview, automatic approval

**Context Build**:
An explicitly requested `explore` run whose outcome is the curation of its parent session's Draft Context Pack.
_Avoid_: Explore delegation, automatic context collection

**Pack Budget**:
The declared maximum context allocation used to curate and seal a Context Pack.
_Avoid_: Recipient context window, advisory size

**Recipient Fit Check**:
The mandatory validation that a Sealed Context Pack fits the chosen receiving session before it is sent.
_Avoid_: Automatic trimming, best-effort send

**Pack Estimate**:
A deterministic provider-neutral token approximation shown while a Context Pack is curated.
_Avoid_: Exact token count, recipient usage

**Recipient Count**:
A token count or conservative upper bound produced by a certified counter for one receiving provider and model.
_Avoid_: Portable estimate, post-send usage

**Recipient Profile**:
The closed, versioned evidence for one exact provider and model's fresh-session capacity, counter, and reserved headroom.
_Avoid_: Explore profile, user-configured context size

**Instruction Mode**:
The operator-selected rule for how a Context Build may transform the original task instructions.
_Avoid_: Prompt style, agent mode

**Preserve Mode**:
An Instruction Mode that keeps the original task instructions byte-for-byte unchanged.
_Avoid_: No context, read-only pack

**Augment Mode**:
The default Instruction Mode that preserves the original task and appends structured discovered context.
_Avoid_: Rewrite, summary

**Rewrite Mode**:
An Instruction Mode that replaces the original task with newly synthesized instructions for explicit review.
_Avoid_: Automatic improvement, silent rewrite

**Context Brief**:
The structured discovery record describing architecture, selected material, relationships, ambiguities, and relevant material omitted by the Pack Budget.
_Avoid_: Implementation plan, free-form report

**Budget Omission**:
Task-relevant workspace material intentionally excluded from a Context Pack to honor its Pack Budget.
_Avoid_: Irrelevant file, accidental omission

**Stale Context Item**:
A Context Pack item whose source material has changed since it was curated.
_Avoid_: Invalid path, automatically rebased item

**Pack Refresh**:
The explicit replacement or reselection of a Stale Context Item from current workspace material with an updated relevance explanation.
_Avoid_: Background refresh, silent rebase

**Pack Revision**:
The current identity of a Draft Context Pack's complete curated state.
_Avoid_: File revision, sealed-pack version

**Stale Curation**:
A child-proposed Context Pack change based on an older Pack Revision than the operator is currently reviewing.
_Avoid_: Merge conflict, delayed approval

**Draft Manifest**:
The persistent paths, ranges, relevance explanations, source identities, and Pack Revision of a Draft Context Pack without copied workspace content.
_Avoid_: Sealed payload, cached source files

**Pack Materialization**:
The creation of an exact redacted payload from a Draft Manifest and current eligible workspace material for Context Pack Review.
_Avoid_: Live file resolution, post-review redaction

**Handoff Bundle**:
The reviewable cross-agent continuation envelope containing conversation context and optionally one Sealed Context Pack.
_Avoid_: Context Pack, prompt conversion

**Context Pack Consumption**:
The operator-confirmed use of a Sealed Context Pack by a receiving agent session or Handoff Bundle.
_Avoid_: Follow-up generation, automatic send

**Context Pack Export**:
An operator-confirmed Markdown copy of a Sealed Context Pack's exact redacted payload and compact provenance.
_Avoid_: Run persistence, automatic workspace artifact

### Workspace Navigation

**Session Workspace**:
The working-directory tree associated with one Kitten session.
_Avoid_: Project folder, global workspace

**File Explorer**:
The navigable view of the focused session's Session Workspace.
_Avoid_: File selector, repository browser

**Explorer Sidebar**:
The toggleable docked presentation of the File Explorer beside a conversation.
_Avoid_: Explorer modal, full-screen explorer

**Narrow Explorer**:
The full-pane File Explorer presentation used only when a terminal cannot show a readable Explorer Sidebar and conversation together.
_Avoid_: Separate explorer workflow, modal explorer

**Workspace Entry**:
A directory, regular file, or Contained Link within a Session Workspace that the File Explorer may display.
_Avoid_: Repository file, source file

**Contained Link**:
A symbolic link whose resolved target remains within its Session Workspace.
_Avoid_: External link, broken link

**External Editor**:
The operating-system application chosen to open a Workspace Entry.
_Avoid_: Selected editor, file handler

**Editor Preference**:
The user's explicitly saved choice to use the system default External Editor or a custom External Editor.
_Avoid_: Per-session editor

**Explorer Tree**:
The lazily expanded hierarchy of Workspace Entries in the File Explorer.
_Avoid_: Directory list, fully expanded tree

**File Opening**:
The user's request to open a regular Workspace Entry in the External Editor while Kitten remains active.
_Avoid_: Embedded editor, file preview

**Explorer Position**:
The current-run navigation state associated with one Session Workspace in the Explorer Tree.
_Avoid_: Global explorer history, persistent explorer state

**Explorer Refresh**:
The user's explicit request to reconcile an Explorer Tree with its Session Workspace.
_Avoid_: Background watcher, automatic refresh

**Custom Editor Command**:
The user's direct External Editor executable and arguments, containing one selected-file placeholder.
_Avoid_: Shell command, editor nickname

**Editor Fallback**:
The automatic use of the system-default External Editor when a Custom Editor Command cannot start.
_Avoid_: Silent no-op, manual recovery prompt

**Explorer Telemetry**:
The opt-in local record of content-free File Explorer interaction outcomes.
_Avoid_: File activity log, path telemetry

**File Explorer Toggle**:
The shared command that reveals and focuses the Explorer Sidebar or hides it when visible.
_Avoid_: Open-only explorer command, separate shortcut behavior

## Relationships

- The Kitten product family ships exactly two applications: **Kitten Cockpit** and **Kitten Orchestrator**
- Every **Theme Preference** selects Auto, Light, Dark, or exactly one **Theme Preset** from the **Curated Theme Catalog**
- A **Theme Family** contributes one or more **Theme Presets** to the **Curated Theme Catalog**
- A **Hard Stop** cancels one active Cockpit turn without closing its Cockpit session
- A **Post-Interrupt Continuation** belongs to one **Hard Stop** and becomes the next ordinary turn only after that interrupted turn settles
- **Kitten Cockpit** and **Kitten Orchestrator** have separate user interfaces, controllers, stores, and entry points but consume common **Shared Capabilities**
- Queue discovery, worktree execution, verification gates, and review governance belong only to **Kitten Orchestrator**
- Every **Orchestrated Work** belongs to exactly one queued task, isolated worktree, branch, original baseline, and at most one pull request
- An Orchestrated Work contains one or more sequential **Run Attempts**
- Review feedback creates a new Run Attempt in the same Orchestrated Work without replacing prior attempts
- Every Run Attempt starts a fresh ACP session and receives one exact **Run Context** before agent execution begins
- Every Run Attempt selects exactly one **Execution Route**
- A **Direct ACP Route** selects exactly one certified Claude, Codex, Cursor, or opt-in Grok Build profile
- A **Grok Build ACP Profile** begins with baseline ACP behavior; advanced capabilities remain unavailable until separately certified
- An **Uncertified Grok Build Session** may run generic ACP behavior but never receives profile-specific certification
- A **Grok Build ACP Profile** never carries credentials or changes Grok Build's provider-owned data policy
- An unavailable Grok Build authentication prerequisite produces fixed remediation rather than persisted credentials or raw diagnostics
- A **Compozy Route** remains subject to the same worktree, budget, permission, verification, and review policy as a Direct ACP Route
- A **Cross-App Handoff** starts a new recipient session and never transfers or shares ownership of the source session
- No live agent session is concurrently owned by Kitten Cockpit and Kitten Orchestrator
- Kitten Cockpit and Kitten Orchestrator read the same **Agent Profile Registry**
- The Agent Profile Registry does not store provider credentials or either application's session, project, queue, attempt, budget, or review data
- Each application owns and migrates its persistent product data independently
- A **Predecessor Import** previews its scope, writes only to Kitten Orchestrator storage, records completion, and can be retried without duplicating data
- Archiving Task Orchestrator requires a verified Predecessor Import path for supported predecessor data
- The first Kitten Orchestrator release admits at most one active Orchestrated Work globally and does not permit autonomous child delegation
- A Run Context may include a **Sealed Context Pack**, but it never creates, seals, trims, or rewrites that pack
- A Context Pack remains optional for Run Attempts and retains the same explicit review requirement as in Kitten Cockpit
- A **Run Attempt** progresses without supervision unless it reaches a policy-defined blocker
- Only an **Attention Blocker** may pause a Run Attempt for reactive user input
- Permission requests within host guardrails are approved automatically; requests beyond them are denied automatically and never become Attention Blockers
- Inspecting or steering a **Run Attempt** does not change unattended execution into the default workflow
- **Kitten Orchestrator** succeeds **Task Orchestrator** inside the Kitten product family
- **Task Orchestrator** is retired only after its desktop behavior, stored data, security boundaries, and verification evidence have a passing Kitten Orchestrator replacement
- Retiring **Task Orchestrator** means importing relevant history, publishing a relocation notice, and archiving its repository read-only
- A **Context Pack** belongs to exactly one **Session Workspace**
- Each session retains at most one Draft Context Pack and one current Sealed Context Pack in V1
- Sealing a new pack replaces the session's current sealed-pack pointer without rewriting a Handoff Bundle that already embeds an older pack
- An `explore` child may prepare a **Context Pack**, but the pack does not belong to that child
- A **Context Pack** may be consumed by its parent session, a delegated child, or a cross-agent hand-off
- Every **Context Pack** begins as a **Draft Context Pack**
- Explicit human review turns a **Draft Context Pack** into a **Sealed Context Pack**
- Changing or refreshing a **Sealed Context Pack** creates a new Draft Context Pack and requires a new review
- A **Context Pack** contains zero or more **Full File Items**, **File Slices**, and **Diff Items**
- A **File Slice** belongs to exactly one Workspace Entry and includes its own relevance explanation
- A **Diff Item** is selected from a bounded host-derived staged or unstaged per-file patch within the Session Workspace, or from an existing pending diff captured by the parent session
- **Context Pack Curation** may be performed by the operator or by an active `explore` child with the **Context Pack Capability**
- The **Context Pack Capability** can change only a Draft Context Pack and inspect bounded in-workspace diff candidates and budget state; it cannot modify the Session Workspace, run general Git or shell commands, seal or send a pack, or launch another agent
- Only a **Context Build** binds an `explore` child to a Draft Context Pack; ordinary `explore` delegation remains report-only
- Context Build is a follow-on capability that requires an `explore-v2` attestation; the completed `explore-v1` contract remains report-only
- A Context Build refines the session's current Draft Context Pack by default
- Refining a Sealed Context Pack first copies its manifest and instructions into a new Draft Context Pack
- Starting with an empty Draft Context Pack is an explicit Start Fresh action and never an implicit replacement of existing operator curation
- The **File Explorer** shows Context Pack membership and provides quick curation actions for Workspace Entries
- **Context Pack Review** is the only path that can turn a Draft Context Pack into a Sealed Context Pack
- A **Sealed Context Pack** is portable and is not owned by a provider, model, or recipient session
- Every send of a **Sealed Context Pack** requires a fresh **Recipient Fit Check**
- A failed Recipient Fit Check never trims or partially sends the pack; revision creates a new Draft Context Pack and review cycle
- Context Pack Curation shows the exact serialized byte size and a clearly labeled **Pack Estimate**
- A new session begins with an adjustable 80k Pack Budget, and its current value persists with the Draft Manifest
- A Draft Context Pack whose Pack Estimate exceeds its Pack Budget cannot be sealed
- A **Recipient Fit Check** passes only when a certified **Recipient Count** and sufficient capacity evidence are both available
- An existing session supplies capacity through live reported headroom; a prospective child supplies it through a current **Recipient Profile**
- Missing recipient accounting makes the fit check unavailable; Kitten never presents the Pack Estimate as proof that a send will fit
- Every Context Build has exactly one **Instruction Mode**
- **Augment Mode** is the default; Preserve Mode and Rewrite Mode require explicit selection
- Instruction Mode changes affect only a Draft Context Pack and remain visible during Context Pack Review
- Every Context Build produces one **Context Brief** with Architecture, Selected Context, Relationships, Ambiguities, and Budget Omissions sections
- A **Context Brief** records observed structure and uncertainty but never proposes a solution or implementation plan
- Augment Mode appends the Context Brief to the preserved task; Rewrite Mode uses it to ground replacement instructions; Preserve Mode keeps it separate from the unchanged task
- Context Pack Review revalidates every selected item's source identity before sealing
- A Draft Context Pack containing a **Stale Context Item** cannot be sealed
- A **Pack Refresh** keeps the pack in draft state and requires the refreshed material and explanation to be reviewed
- Operator and Context Build edits may update the same Draft Context Pack while the build is active
- A Draft Context Pack has at most one active Context Build child in V1; unrelated `explore` children remain governed by normal delegation capacity
- Every accepted edit advances the **Pack Revision**
- Operator edits take effect immediately; **Stale Curation** from an `explore` child is rejected and the child must reread the current draft before proposing another change
- A **Draft Manifest** may survive restart, but an active Context Build child and its capability claim never do
- **Pack Materialization** revalidates source identity and redacts material before Context Pack Review
- Existing run persistence stores the Draft Manifest and the exact redacted payload of a Sealed Context Pack
- A **Handoff Bundle** may carry at most one Sealed Context Pack in V1
- A Handoff Bundle retains conversation and shell continuation context while the attached Context Pack retains curated task and workspace context
- Handoff assembly deduplicates envelope files and diffs already represented by the attached pack without modifying the Sealed Context Pack
- The attached pack is immutable during hand-off review; changing its contents requires a new Draft Context Pack and Context Pack Review
- Context Build completion produces only a Draft Context Pack ready for review and never starts follow-up generation
- **Context Pack Consumption** requires an explicit choice to send to the current session, start a delegated child, or attach the pack to a Handoff Bundle
- A **Context Pack Export** writes only after the operator chooses a destination and confirms the copy
- Export never occurs automatically during Context Build, Context Pack Review, sealing, persistence, or consumption
- Each focused Kitten session has exactly one **Session Workspace**
- The **File Explorer** displays the **Session Workspace** of the focused session
- The **Explorer Sidebar** presents the **File Explorer** without replacing the conversation
- The **Narrow Explorer** temporarily replaces the conversation only at an unreadable shared width
- A fresh Kitten launch begins with the **Explorer Sidebar** hidden
- The **File Explorer** displays eligible **Workspace Entries**, including hidden and ignored entries, but never the `.git` directory or a path outside the **Session Workspace**
- A **Contained Link** is an eligible **Workspace Entry**; broken links and links outside the Session Workspace are hidden
- An **Editor Preference** selects the **External Editor** that opens a **Workspace Entry**
- The **Explorer Sidebar** renders the **File Explorer** as an **Explorer Tree**
- A **File Opening** preserves the visible and focused **Explorer Sidebar**
- Directories are navigation-only Workspace Entries and are not File Opening targets
- Each Session Workspace has at most one in-memory **Explorer Position** during a Kitten run
- An **Explorer Refresh** updates the Explorer Tree only when requested by the user
- A custom **Editor Preference** is represented by one **Custom Editor Command**
- A failed **Custom Editor Command** triggers the **Editor Fallback**
- **Explorer Telemetry** never records a Workspace Entry path, Editor Preference, or error text
- The File Explorer Toggle is available through both `Ctrl+B` and `/file-explorer`

## Example dialogue

> **Dev:** "The `explore` child found the relevant files. Is its answer the reusable context?"
> **Domain expert:** "No — the child prepares a **Context Pack**, which the session can review and send to another agent independently of that child."

> **Dev:** "A selected file changed after I approved the pack. Does the agent receive the new version?"
> **Domain expert:** "No — the **Sealed Context Pack** keeps the exact reviewed content. Refreshing it creates a new **Draft Context Pack** that must be reviewed again."

> **Dev:** "Does letting an `explore` child curate context give it permission to edit the repository or send the result?"
> **Domain expert:** "No — its **Context Pack Capability** can revise only the parent's **Draft Context Pack** and inspect its budget; sealing and sending remain human actions."

> **Dev:** "Can I seal the pack directly from a file row in the **File Explorer**?"
> **Domain expert:** "No — the explorer supports quick curation, while **Context Pack Review** shows the complete payload and owns sealing."

> **Dev:** "This pack fit Codex when I sealed it. Can I send it to a smaller Claude session unchanged?"
> **Domain expert:** "Only if a fresh **Recipient Fit Check** passes; otherwise you must revise and review a new draft. Kitten never silently trims the sealed payload."

> **Dev:** "I switched from the API conversation to the web conversation. Which files does the **File Explorer** show?"
> **Domain expert:** "It shows the web conversation's **Session Workspace** in the **Explorer Sidebar**, because the explorer follows the focused session."

## Flagged ambiguities

- "transform Task Orchestrator" initially suggested evolving its repository in place — resolved: Kitten becomes the destination monorepo and **Task Orchestrator** is the retiring predecessor.
- "reuse the engine" was ambiguous between one application controller and reusable runtime capabilities — resolved: the applications retain separate lifecycles and consume **Shared Capabilities** beneath them.
- "desktop app" was ambiguous between an opaque task runner and an interactive cockpit — resolved: a **Run Attempt** is unattended by default but its durable session is inspectable and steerable on demand.
- "blocker" was ambiguous between a task clarification and an agent permission request — resolved: only a bounded clarification is an **Attention Blocker**; permissions remain host-policy decisions.
- "reuse context" was ambiguous between automatic run assembly and auto-sending a curated Context Pack — resolved: ordinary tasks receive a **Run Context**, while Context Packs remain optional and explicitly reviewed.
- "run" was used for both the task's end-to-end review lineage and one agent execution — resolved: **Orchestrated Work** is the lineage and **Run Attempt** is one execution.
- "reuse the engine" was also ambiguous about discarding the predecessor UI and persistence — resolved: the existing desktop product is the parity baseline, then shared Kitten capabilities replace its internals incrementally.
- "engine" was used for both a provider transport and the Compozy workflow — resolved: **Execution Route** distinguishes direct ACP profiles from the higher-level **Compozy Route**.
- "grok" could mean the executable or the provider — resolved: **Grok Build** uses the `grok-build` provider identity, while `grok` names only the external CLI.
- "shared session" was ambiguous between portable context and shared runtime ownership — resolved: applications exchange an explicitly reviewed **Cross-App Handoff**, and the recipient creates a new owned session.
- "shared core" was ambiguous about a shared database — resolved: the applications share the **Agent Profile Registry** and code contracts, while all product data remains app-owned.
- "orchestration" did not imply first-release parallelism — resolved: V1 preserves one globally active Orchestrated Work and defers autonomous child delegation.
- "preserve stored data" was ambiguous between schema parity and mutating the predecessor database — resolved: Kitten Orchestrator performs an explicit **Predecessor Import** and retains the original for rollback.
- "kill the Task Orchestrator repo" was ambiguous between deletion and retirement — resolved: import relevant history into Kitten, then archive the predecessor repository read-only with a relocation notice.
- "context" was used for both an agent's context window and a curated reusable artifact — resolved: the reusable artifact is a **Context Pack**.
- "similar to RepoPrompt" could mean matching its workflow or cloning its codemap platform — resolved for V1: match the curated-selection workflow with full files, described slices, and diffs; defer codemaps and automatic dependency graphs.
- "explore" was used for both general investigation and Context Pack Curation — resolved: general delegation remains `explore`, while an explicitly requested **Context Build** curates the pack.
- "the folder" was ambiguous when a run has sessions with different working directories — resolved: it means the focused session's **Session Workspace**.
