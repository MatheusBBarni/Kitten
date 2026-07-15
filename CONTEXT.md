# Kitten Workspace Navigation

This context defines the user-facing workspace concepts used when navigating project files from a Kitten conversation. It keeps a conversation's file context aligned with its working directory.

## Language

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

> **Dev:** "I switched from the API conversation to the web conversation. Which files does the **File Explorer** show?"
> **Domain expert:** "It shows the web conversation's **Session Workspace** in the **Explorer Sidebar**, because the explorer follows the focused session."

## Flagged ambiguities

- "the folder" was ambiguous when a run has sessions with different working directories — resolved: it means the focused session's **Session Workspace**.
