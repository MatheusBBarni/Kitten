import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  Button,
  Dropdown,
  Input,
  Label,
  Modal,
  SearchField,
  Skeleton,
  TextField,
} from "@heroui/react";
import {
  createEmptySupervisionProjection,
  type SupervisionItem,
  type SupervisionProjection,
  type SupervisionStatus,
  type WorkspaceBoardSummary,
  type WorkspaceProjection,
} from "../../../shared/rpc.ts";
import {
  ArchiveIcon,
  BoardIcon,
  ChevronDownIcon,
  EditIcon,
  FolderIcon,
  MoreIcon,
  PathIcon,
  PinIcon,
  PlusIcon,
  TrashIcon,
} from "../../components/Icons.tsx";
import { useDesktopViewStore } from "../../state/desktopViewStore.ts";

const PREFERENCES_KEY = "kitten:project-sidebar-preferences:v1";

interface SidebarPreference {
  readonly name?: string;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly hidden?: boolean;
}

type SidebarPreferences = Readonly<Record<string, SidebarPreference>>;

interface SidebarProject {
  readonly key: string;
  readonly repositoryPath: string;
  readonly name: string;
  readonly boards: readonly WorkspaceBoardSummary[];
  readonly preference: SidebarPreference;
  readonly updatedAt: number;
}

interface SidebarTarget {
  readonly kind: "project" | "board";
  readonly preferenceKey: string;
  readonly label: string;
}

export type WorkInboxState =
  | { readonly status: "loading" }
  | {
      readonly status: "unavailable";
      readonly reason: "host_stopped" | "projection_rejected" | "not_ready" | "request_failed";
    }
  | { readonly status: "ready"; readonly projection: SupervisionProjection };

export interface WorkInboxSelection {
  readonly item: SupervisionItem;
  readonly repositoryPath: string;
}

export interface SelectedWorkInboxItem {
  readonly boardId: string;
  readonly cardId: string;
}

interface WorkInboxRow {
  readonly item: SupervisionItem;
  readonly repositoryPath: string;
  readonly repositoryLabel: string;
  readonly boardLabel: string;
  readonly cardLabel: string;
  readonly evidenceLabel: string;
  readonly navigationAvailable: boolean;
  readonly searchText: string;
}

interface WorkInboxGroup {
  readonly status: SupervisionStatus;
  readonly count: number;
  readonly rows: readonly WorkInboxRow[];
}

interface ActionableTime {
  readonly label: string;
  readonly dateTime?: string;
  readonly title?: string;
}

const supervisionStatusLabel: Readonly<Record<SupervisionStatus, string>> = {
  needs_attention: "Attention",
  ready_for_review: "Ready for review",
  failed: "Failed",
  running: "Running",
  settled: "Settled",
};

const supervisionStatusTone: Readonly<Record<SupervisionStatus, string>> = {
  needs_attention: "text-[var(--kitten-status-attention)]",
  ready_for_review: "text-[var(--kitten-status-review)]",
  failed: "text-[var(--kitten-status-failure)]",
  running: "text-[var(--kitten-status-running)]",
  settled: "text-[var(--kitten-status-success)]",
};

const supervisionStatusSurface: Readonly<Record<SupervisionStatus, string>> = {
  needs_attention: "border-[var(--kitten-status-attention-border)] bg-[var(--kitten-status-attention-surface)]",
  ready_for_review: "border-[var(--kitten-status-review-border)] bg-[var(--kitten-status-review-surface)]",
  failed: "border-[var(--kitten-status-failure-border)] bg-[var(--kitten-status-failure-surface)]",
  running: "border-[var(--kitten-status-running-border)] bg-[var(--kitten-status-running-surface)]",
  settled: "border-[var(--kitten-status-success-border)] bg-[var(--kitten-status-success-surface)]",
};

const evidenceUnavailableLabel = {
  evidence_missing: "Review evidence unavailable: capture is missing",
  evidence_stale: "Review evidence unavailable: refresh the card",
  evidence_oversized: "Review evidence unavailable: change set is too large",
  evidence_unsafe: "Review evidence unavailable: change set is unsafe",
  worktree_binding_mismatch: "Review evidence unavailable: worktree changed",
} as const;

function evidenceLabel(item: SupervisionItem): string {
  if (item.evidenceAvailability.status === "available") return "Review evidence available";
  if (item.evidenceAvailability.status === "not_applicable") return "Review evidence not required";
  return evidenceUnavailableLabel[item.evidenceAvailability.error.code as keyof typeof evidenceUnavailableLabel]
    ?? "Review evidence unavailable";
}

function actionableTime(timestamp: number): ActionableTime {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return { label: "Actionable time unavailable" };
  const title = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1_000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  const [value, unit] = absoluteSeconds < 60
    ? [deltaSeconds, "second" as const]
    : absoluteSeconds < 3_600
      ? [Math.round(deltaSeconds / 60), "minute" as const]
      : absoluteSeconds < 86_400
        ? [Math.round(deltaSeconds / 3_600), "hour" as const]
        : [Math.round(deltaSeconds / 86_400), "day" as const];
  return {
    label: `Actionable ${new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(value, unit)}`,
    dateTime: date.toISOString(),
    title,
  };
}

function unavailableGuidance(reason: WorkInboxState & { readonly status: "unavailable" }): string {
  if (reason.reason === "host_stopped") {
    return "The desktop host stopped. Board navigation remains available; restart Kitten to refresh supervised work.";
  }
  if (reason.reason === "projection_rejected") {
    return "The host rejected the Work Inbox projection. Board navigation remains available; refresh after the next workflow update.";
  }
  if (reason.reason === "request_failed") {
    return "Couldn't load the Work Inbox. Board navigation remains available; wait for the desktop host to reconnect.";
  }
  return "The Work Inbox is not ready. Board navigation remains available while the host starts.";
}

export function workInboxItemFocusId(boardId: string, cardId: string): string {
  return `work-inbox-card-${boardId}-${cardId}`;
}

export const PROJECT_SIDEBAR_SEARCH_ID = "project-sidebar-search";

function readPreferences(): SidebarPreferences {
  try {
    if (typeof window === "undefined") return {};
    const stored = window.localStorage.getItem(PREFERENCES_KEY);
    if (stored === null) return {};
    const parsed = JSON.parse(stored) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SidebarPreferences
      : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences: SidebarPreferences): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    }
  } catch {
    // Sidebar preferences remain available in memory when browser storage is unavailable.
  }
}

export function projectName(repositoryPath: string): string {
  const segments = repositoryPath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? repositoryPath;
}

function normalizedRepositoryPath(repositoryPath: string): string {
  return repositoryPath.replaceAll("\\", "/").replace(/\/+$/, "");
}

function projectPreferenceKey(repositoryPath: string): string {
  return `project:${normalizedRepositoryPath(repositoryPath)}`;
}

function projectTreeId(projectKey: string): string {
  let hash = 0;
  for (const character of projectKey) hash = ((hash * 31) + character.codePointAt(0)!) >>> 0;
  return `project-boards-${hash.toString(36)}`;
}

function boardDisplayName(
  board: WorkspaceBoardSummary,
  projectBoards: readonly WorkspaceBoardSummary[],
  preferences: SidebarPreferences,
): string {
  const customName = preferences[board.boardId]?.name?.trim();
  if (customName) return customName;
  const ordered = [...projectBoards].sort((left, right) => (
    left.createdAt - right.createdAt || left.boardId.localeCompare(right.boardId)
  ));
  const index = ordered.findIndex(({ boardId }) => boardId === board.boardId);
  return index <= 0 ? "Main board" : `Board ${index + 1}`;
}

function projectDisplayName(repositoryPath: string, preferences: SidebarPreferences): string {
  return preferences[projectPreferenceKey(repositoryPath)]?.name?.trim() || projectName(repositoryPath);
}

function sortBoards(
  boards: readonly WorkspaceBoardSummary[],
  preferences: SidebarPreferences,
): readonly WorkspaceBoardSummary[] {
  return [...boards].sort((left, right) => {
    const leftPreference = preferences[left.boardId] ?? {};
    const rightPreference = preferences[right.boardId] ?? {};
    if (Boolean(leftPreference.archived) !== Boolean(rightPreference.archived)) return leftPreference.archived ? 1 : -1;
    if (Boolean(leftPreference.pinned) !== Boolean(rightPreference.pinned)) return leftPreference.pinned ? -1 : 1;
    return left.createdAt - right.createdAt || left.boardId.localeCompare(right.boardId);
  });
}

interface ProjectSidebarProps {
  readonly workspace: WorkspaceProjection;
  readonly activeBoardId: string | null;
  readonly busy: boolean;
  readonly onOpenProject: () => void;
  readonly onAddBoard: (repositoryPath: string) => void;
  readonly onSelectBoard: (boardId: string) => void;
  readonly onEditPath: (boardId: string) => void;
  readonly workInbox?: WorkInboxState;
  readonly selectedInboxItem?: SelectedWorkInboxItem | null;
  readonly onSelectInboxItem?: (selection: WorkInboxSelection) => void;
}

export function ProjectSidebar({
  workspace,
  activeBoardId,
  busy,
  onOpenProject,
  onAddBoard,
  onSelectBoard,
  onEditPath,
  workInbox = {
    status: "ready",
    projection: createEmptySupervisionProjection(workspace.revision),
  },
  selectedInboxItem = null,
  onSelectInboxItem = () => {},
}: ProjectSidebarProps) {
  const [preferences, setPreferences] = useState<SidebarPreferences>(readPreferences);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<SidebarTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<SidebarTarget | null>(null);
  const collapsedProjectKeys = useDesktopViewStore((state) => state.collapsedProjectKeys);
  const toggleProjectExpanded = useDesktopViewStore((state) => state.toggleProjectExpanded);

  useEffect(() => writePreferences(preferences), [preferences]);

  function updatePreference(key: string, patch: Partial<SidebarPreference>) {
    setPreferences((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  }

  function beginRename(target: SidebarTarget) {
    setRenaming(target);
    setRenameDraft(target.label);
  }

  const visibleProjects = useMemo<readonly SidebarProject[]>(() => {
    const grouped = new Map<string, WorkspaceBoardSummary[]>();
    for (const board of workspace.boards) {
      const key = normalizedRepositoryPath(board.repositoryPath);
      grouped.set(key, [...(grouped.get(key) ?? []), board]);
    }
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...grouped.entries()].flatMap(([repositoryPath, projectBoards]) => {
      const key = projectPreferenceKey(repositoryPath);
      const preference = preferences[key] ?? {};
      if (preference.hidden) return [];
      const name = projectDisplayName(repositoryPath, preferences);
      const visibleBoards = projectBoards.filter(({ boardId }) => !preferences[boardId]?.hidden);
      const projectMatches = normalizedQuery.length === 0
        || name.toLocaleLowerCase().includes(normalizedQuery)
        || repositoryPath.toLocaleLowerCase().includes(normalizedQuery);
      const matchingBoards = projectMatches
        ? visibleBoards
        : visibleBoards.filter((board) => boardDisplayName(board, projectBoards, preferences).toLocaleLowerCase().includes(normalizedQuery));
      if (matchingBoards.length === 0) return [];
      return [{
        key,
        repositoryPath,
        name,
        boards: sortBoards(matchingBoards, preferences),
        preference,
        updatedAt: Math.max(...projectBoards.map(({ updatedAt }) => updatedAt)),
      }];
    }).sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
  }, [preferences, query, workspace.boards]);

  const pinned = visibleProjects.filter(({ preference }) => preference.pinned && !preference.archived);
  const projects = visibleProjects.filter(({ preference }) => !preference.pinned && !preference.archived);
  const archived = visibleProjects.filter(({ preference }) => preference.archived);
  const workInboxGroups = useMemo<readonly WorkInboxGroup[]>(() => {
    if (workInbox.status !== "ready") return [];
    const boardsById = new Map(workspace.boards.map((board) => [board.boardId, board]));
    const boardsByRepository = new Map<string, WorkspaceBoardSummary[]>();
    for (const board of workspace.boards) {
      const repositoryPath = normalizedRepositoryPath(board.repositoryPath);
      boardsByRepository.set(repositoryPath, [
        ...(boardsByRepository.get(repositoryPath) ?? []),
        board,
      ]);
    }
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return workInbox.projection.groups.map((group) => {
      const rows = group.items.flatMap((item): readonly WorkInboxRow[] => {
        const board = boardsById.get(item.boardId);
        const repositoryPath = board === undefined
          ? ""
          : normalizedRepositoryPath(board.repositoryPath);
        const projectKey = projectPreferenceKey(repositoryPath);
        if (preferences[projectKey]?.hidden || preferences[item.boardId]?.hidden) return [];
        const repositoryLabel = repositoryPath.length === 0
          ? "Repository unavailable"
          : projectDisplayName(repositoryPath, preferences);
        const boardLabel = board === undefined
          ? `Board ${item.boardId}`
          : boardDisplayName(
              board,
              boardsByRepository.get(repositoryPath) ?? [board],
              preferences,
            );
        const cardLabel = `Card ${item.cardId}`;
        const itemEvidenceLabel = evidenceLabel(item);
        const searchText = [
          repositoryLabel,
          repositoryPath,
          boardLabel,
          item.boardId,
          cardLabel,
          item.cardId,
          supervisionStatusLabel[item.status],
        ].join("\n").toLocaleLowerCase();
        if (normalizedQuery.length > 0 && !searchText.includes(normalizedQuery)) return [];
        return [{
          item,
          repositoryPath,
          repositoryLabel,
          boardLabel,
          cardLabel,
          evidenceLabel: itemEvidenceLabel,
          navigationAvailable: repositoryPath.length > 0,
          searchText,
        }];
      });
      return {
        status: group.status,
        count: workInbox.projection.counts[group.status],
        rows,
      };
    });
  }, [preferences, query, workInbox, workspace.boards]);
  const visibleInboxItemCount = workInboxGroups.reduce((count, group) => count + group.rows.length, 0);
  const nextActionableItem = workInboxGroups.flatMap(({ rows }) => rows).at(0)?.item ?? null;
  const authoritativeInboxItemCount = workInbox.status === "ready"
    ? Object.values(workInbox.projection.counts).reduce((count, groupCount) => count + groupCount, 0)
    : 0;

  function group(label: string, groupedProjects: readonly SidebarProject[]) {
    if (groupedProjects.length === 0) return null;
    const headingId = `project-group-${label.toLocaleLowerCase()}`;
    return (
      <section className="project-group" aria-labelledby={headingId}>
        <h3 id={headingId} className="project-group-title">{label}</h3>
        <ul className="m-0 grid list-none gap-2 p-0">
          {groupedProjects.map((project) => {
            const containsActiveBoard = project.boards.some(({ boardId }) => boardId === activeBoardId);
            const expanded = query.trim().length > 0 || collapsedProjectKeys[project.key] !== true;
            return (
              <li key={project.key} className="min-w-0">
                <div
                  data-active={containsActiveBoard}
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_2.5rem] items-center rounded-md text-foreground data-[active=true]:font-semibold"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="grid min-h-full min-w-0 grid-cols-[1rem_1rem_minmax(0,1fr)] items-center gap-2 rounded-[inherit] border-0 bg-transparent px-3 py-2 text-left text-inherit"
                    aria-expanded={expanded}
                    aria-controls={projectTreeId(project.key)}
                    onPress={() => toggleProjectExpanded(project.key)}
                    isDisabled={busy}
                  >
                    <ChevronDownIcon className={`transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`} />
                    <FolderIcon />
                    <span className="min-w-0">
                      <span className="block truncate text-sm leading-5">{project.name}</span>
                      <span className="block text-xs font-normal text-muted">{project.boards.length} {project.boards.length === 1 ? "board" : "boards"}</span>
                    </span>
                  </Button>
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label={`Project actions for ${project.name}`}
                      className="grid size-8 place-self-center place-items-center rounded-md text-muted hover:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] hover:text-foreground"
                      isDisabled={busy}
                    >
                      <MoreIcon />
                    </Dropdown.Trigger>
                    <Dropdown.Popover placement="right top">
                      <Dropdown.Menu
                        aria-label={`Actions for project ${project.name}`}
                        onAction={(key) => {
                          if (key === "add-board") onAddBoard(project.repositoryPath);
                          if (key === "rename") beginRename({ kind: "project", preferenceKey: project.key, label: project.name });
                          if (key === "pin") updatePreference(project.key, { pinned: !project.preference.pinned, archived: false });
                          if (key === "archive") updatePreference(project.key, { archived: !project.preference.archived, pinned: false });
                          if (key === "delete") setDeleting({ kind: "project", preferenceKey: project.key, label: project.name });
                        }}
                      >
                        <Dropdown.Item id="add-board" textValue="Add board"><PlusIcon />Add board</Dropdown.Item>
                        <Dropdown.Item id="rename" textValue="Rename project"><EditIcon />Rename</Dropdown.Item>
                        <Dropdown.Item id="pin" textValue={project.preference.pinned ? "Unpin project" : "Pin project"}>
                          <PinIcon />{project.preference.pinned ? "Unpin" : "Pin"}
                        </Dropdown.Item>
                        <Dropdown.Item id="archive" textValue={project.preference.archived ? "Unarchive project" : "Archive project"}>
                          <ArchiveIcon />{project.preference.archived ? "Unarchive" : "Archive"}
                        </Dropdown.Item>
                        <Dropdown.Item id="delete" variant="danger" textValue="Delete project from sidebar">
                          <TrashIcon />Delete from sidebar
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                </div>

                {expanded ? <ul id={projectTreeId(project.key)} className="ml-5 grid list-none gap-1 border-l border-[var(--border)] py-1 pl-2">
                  {project.boards.map((board) => {
                    const selected = board.boardId === activeBoardId;
                    const preference = preferences[board.boardId] ?? {};
                    const name = boardDisplayName(board, workspace.boards.filter(({ repositoryPath }) => (
                      normalizedRepositoryPath(repositoryPath) === normalizedRepositoryPath(project.repositoryPath)
                    )), preferences);
                    return (
                      <li
                        key={board.boardId}
                        data-selected={selected}
                        data-archived={Boolean(preference.archived)}
                        className="grid min-h-11 grid-cols-[minmax(0,1fr)_2.5rem] items-center rounded-md bg-transparent text-foreground hover:bg-[var(--surface-hover)] data-[archived=true]:text-muted data-[selected=true]:bg-[var(--accent-soft)] data-[selected=true]:font-semibold data-[selected=true]:text-[var(--accent-soft-foreground)]"
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="grid min-h-full w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-[inherit] border-0 bg-transparent px-3 py-2 text-left text-inherit"
                          aria-current={selected ? "page" : undefined}
                          onPress={() => onSelectBoard(board.boardId)}
                          isDisabled={busy}
                        >
                          {preference.archived ? <ArchiveIcon /> : <BoardIcon />}
                          <span className="block min-w-0 truncate text-sm leading-5">{name}</span>
                        </Button>
                        <Dropdown>
                          <Dropdown.Trigger
                            aria-label={`Board actions for ${name}`}
                            className="grid size-8 place-self-center place-items-center rounded-md text-muted hover:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] hover:text-foreground"
                            isDisabled={busy}
                          >
                            <MoreIcon />
                          </Dropdown.Trigger>
                          <Dropdown.Popover placement="right top">
                            <Dropdown.Menu
                              aria-label={`Actions for board ${name}`}
                              onAction={(key) => {
                                if (key === "rename") beginRename({ kind: "board", preferenceKey: board.boardId, label: name });
                                if (key === "path") onEditPath(board.boardId);
                                if (key === "pin") updatePreference(board.boardId, { pinned: !preference.pinned, archived: false });
                                if (key === "archive") updatePreference(board.boardId, { archived: !preference.archived, pinned: false });
                                if (key === "delete") setDeleting({ kind: "board", preferenceKey: board.boardId, label: name });
                              }}
                            >
                              <Dropdown.Item id="rename" textValue="Rename board"><EditIcon />Rename</Dropdown.Item>
                              <Dropdown.Item id="path" textValue="Edit workflow path"><PathIcon />Path</Dropdown.Item>
                              <Dropdown.Item id="pin" textValue={preference.pinned ? "Unpin board" : "Pin board"}>
                                <PinIcon />{preference.pinned ? "Unpin" : "Pin"}
                              </Dropdown.Item>
                              <Dropdown.Item id="archive" textValue={preference.archived ? "Unarchive board" : "Archive board"}>
                                <ArchiveIcon />{preference.archived ? "Unarchive" : "Archive"}
                              </Dropdown.Item>
                              <Dropdown.Item id="delete" variant="danger" textValue="Delete board from sidebar">
                                <TrashIcon />Delete from sidebar
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </li>
                    );
                  })}
                </ul> : null}
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <aside
      className="project-sidebar h-dvh min-h-0 border-r border-[var(--kitten-border-subtle)] bg-[var(--kitten-surface-navigation)]"
      aria-label="Repository navigation"
    >
      <header className="project-sidebar-header">
        <div className="project-sidebar-brand">
          <img src="./kitten-icon.png" alt="" aria-hidden="true" className="size-8 shrink-0 rounded-lg" />
          <span>Kitten</span>
        </div>
      </header>

      <div className="project-sidebar-actions">
        <Button variant="ghost" size="sm" onPress={onOpenProject} isDisabled={busy}>
          <PlusIcon />Open project
        </Button>
        <SearchField value={query} onChange={setQuery} aria-label="Search projects, boards, and cards" variant="secondary">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input id={PROJECT_SIDEBAR_SEARCH_ID} placeholder="Search projects, boards, and cards" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      <div className="project-sidebar-scroll">
        <section aria-labelledby="work-inbox-heading" className="mb-4 border-b border-[var(--separator)] pb-4">
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <h2 id="work-inbox-heading" className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-muted">
              Work Inbox
            </h2>
            {workInbox.status === "ready" ? (
              <span
                className="text-xs font-semibold tabular-nums text-muted"
                aria-label={`${authoritativeInboxItemCount} supervised ${authoritativeInboxItemCount === 1 ? "card" : "cards"}`}
              >
                {authoritativeInboxItemCount}
              </span>
            ) : null}
          </div>
          {workInbox.status === "loading" ? (
            <div aria-busy="true" aria-label="Loading Work Inbox" className="grid gap-2 px-2 pb-1">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-16 w-full rounded-md" />
              ))}
              <span className="sr-only">Loading Work Inbox…</span>
            </div>
          ) : workInbox.status === "unavailable" ? (
            <p role="alert" className="m-0 px-2 pb-1 text-xs leading-5 text-muted">
              <strong className="text-foreground">Work Inbox unavailable.</strong>{" "}
              {unavailableGuidance(workInbox)}
            </p>
          ) : authoritativeInboxItemCount === 0 ? (
            <p className="m-0 px-2 pb-1 text-xs leading-5 text-muted">
              {workspace.boards.length === 0
                ? "Open a repository to create work for the inbox."
                : "No cards need supervision yet."}
            </p>
          ) : visibleInboxItemCount === 0 && query.trim().length > 0 ? (
            <p role="status" className="m-0 px-2 pb-1 text-xs leading-5 text-muted">
              No Work Inbox items match this search. Clear the search to see all supervised cards.
            </p>
          ) : visibleInboxItemCount === 0 ? (
            <p role="status" className="m-0 px-2 pb-1 text-xs leading-5 text-muted">
              Supervised cards are hidden by sidebar preferences. Reopen the project to restore them.
            </p>
          ) : (
            <nav aria-label="Work Inbox" className="min-w-0 overflow-hidden">
              <div className="grid min-w-0 gap-3 overflow-hidden">
                {workInboxGroups.map((group) => {
                  const headingId = `work-inbox-${group.status}`;
                  return (
                    <section key={group.status} aria-labelledby={headingId} className="min-w-0 overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-2 pb-1">
                        <h3
                          id={headingId}
                          className={`m-0 text-xs font-semibold ${supervisionStatusTone[group.status]}`}
                        >
                          {supervisionStatusLabel[group.status]}
                        </h3>
                        <span
                          className="text-xs tabular-nums text-muted"
                          aria-label={`${group.count} ${supervisionStatusLabel[group.status]} ${group.count === 1 ? "item" : "items"}`}
                        >
                          {group.count}
                        </span>
                      </div>
                      {group.rows.length === 0 ? null : (
                        <ul className="m-0 grid min-w-0 list-none gap-1 overflow-hidden p-0">
                          {group.rows.map((row) => {
                            const selected = selectedInboxItem?.boardId === row.item.boardId
                              && selectedInboxItem.cardId === row.item.cardId;
                            const statusLabel = supervisionStatusLabel[row.item.status];
                            const itemActionableTime = actionableTime(row.item.actionableAt);
                            return (
                              <li key={`${row.item.boardId}:${row.item.cardId}`} className="min-w-0 overflow-hidden">
                                <Button
                                  id={workInboxItemFocusId(row.item.boardId, row.item.cardId)}
                                  data-desktop-command-target={
                                    nextActionableItem?.boardId === row.item.boardId
                                    && nextActionableItem.cardId === row.item.cardId
                                      ? "next-actionable"
                                      : undefined
                                  }
                                  variant="ghost"
                                  size="sm"
                                  fullWidth
                                  aria-current={selected ? "true" : undefined}
                                  aria-label={`Open ${row.cardLabel} in ${row.boardLabel}, ${row.repositoryLabel}. Status ${statusLabel}. ${itemActionableTime.label}. ${row.evidenceLabel}.${row.navigationAvailable ? "" : " Navigation unavailable until repository details load."}`}
                                  className={`grid min-h-20 w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_5rem] items-start gap-2 overflow-hidden rounded-[var(--kitten-radius-control)] border px-2 py-2 text-left aria-[current=true]:ring-2 aria-[current=true]:ring-[var(--kitten-focus)] ${supervisionStatusSurface[row.item.status]}`}
                                  onPress={() => onSelectInboxItem({
                                    item: row.item,
                                    repositoryPath: row.repositoryPath,
                                  })}
                                  isDisabled={busy || !row.navigationAvailable}
                                >
                                  <span className="grid min-w-0 overflow-hidden gap-0.5">
                                    <span className="truncate text-xs font-semibold text-foreground">{row.cardLabel}</span>
                                    <span className="truncate text-xs text-muted">{row.repositoryLabel} / {row.boardLabel}</span>
                                    <span className="truncate text-xs text-muted">
                                      {statusLabel} · {row.evidenceLabel}
                                      {row.navigationAvailable ? null : " · Navigation unavailable"}
                                    </span>
                                  </span>
                                  <time
                                    dateTime={itemActionableTime.dateTime}
                                    title={itemActionableTime.title}
                                    className="w-20 min-w-0 truncate text-right text-xs leading-4 text-muted"
                                  >
                                    {itemActionableTime.label}
                                  </time>
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            </nav>
          )}
        </section>
        {visibleProjects.length === 0 ? (
          <p className="project-sidebar-empty">
            {workspace.boards.length === 0 ? "Open a repository to create its first board." : "No projects or boards match this search."}
          </p>
        ) : (
          <nav aria-label="Projects and boards">
            {group("Pinned", pinned)}
            {group("Projects", projects)}
            {group("Archived", archived)}
          </nav>
        )}
      </div>

      <Modal.Backdrop isOpen={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Rename {renaming?.kind ?? "item"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField value={renameDraft} onChange={setRenameDraft} autoFocus isRequired>
                <Label>{renaming?.kind === "board" ? "Board name" : "Project name"}</Label>
                <Input variant="secondary" />
              </TextField>
              <p className="field-help">
                {renaming?.kind === "board"
                  ? "This changes the sidebar label only. Workflow history is unchanged."
                  : "This changes the sidebar label only. The repository folder is not renamed."}
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => setRenaming(null)}>Cancel</Button>
              <Button
                onPress={() => {
                  if (renaming === null || renameDraft.trim().length === 0) return;
                  updatePreference(renaming.preferenceKey, { name: renameDraft.trim() });
                  setRenaming(null);
                }}
                isDisabled={renameDraft.trim().length === 0}
              >
                Save name
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <AlertDialog.Backdrop isOpen={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger"><TrashIcon /></AlertDialog.Icon>
              <AlertDialog.Heading>Delete this {deleting?.kind ?? "item"} from the sidebar?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {deleting?.kind === "board"
                ? "The board and its durable workflow history stay on disk. Reopening the project restores access."
                : "The repository and all its durable board histories stay on disk. You can reopen the folder later."}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="secondary" onPress={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onPress={() => {
                  if (deleting === null) return;
                  updatePreference(deleting.preferenceKey, { hidden: true, pinned: false, archived: false });
                  setDeleting(null);
                }}
              >
                Delete from sidebar
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </aside>
  );
}
