import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  Button,
  Dropdown,
  Input,
  Label,
  Modal,
  SearchField,
  TextField,
} from "@heroui/react";
import type { WorkspaceBoardSummary, WorkspaceProjection } from "../../../shared/rpc.ts";
import {
  ArchiveIcon,
  BoardIcon,
  EditIcon,
  FolderIcon,
  MoreIcon,
  PathIcon,
  PinIcon,
  PlusIcon,
  TrashIcon,
} from "../../components/Icons.tsx";

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
}

export function ProjectSidebar({
  workspace,
  activeBoardId,
  busy,
  onOpenProject,
  onAddBoard,
  onSelectBoard,
  onEditPath,
}: ProjectSidebarProps) {
  const [preferences, setPreferences] = useState<SidebarPreferences>(readPreferences);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<SidebarTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<SidebarTarget | null>(null);

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

  function group(label: string, groupedProjects: readonly SidebarProject[]) {
    if (groupedProjects.length === 0) return null;
    const headingId = `project-group-${label.toLocaleLowerCase()}`;
    return (
      <section className="project-group" aria-labelledby={headingId}>
        <h3 id={headingId} className="project-group-title">{label}</h3>
        <ul className="m-0 grid list-none gap-2 p-0">
          {groupedProjects.map((project) => {
            const containsActiveBoard = project.boards.some(({ boardId }) => boardId === activeBoardId);
            return (
              <li key={project.key} className="min-w-0">
                <div
                  data-active={containsActiveBoard}
                  className="grid min-h-12 grid-cols-[minmax(0,1fr)_2.5rem] items-center rounded-md text-foreground data-[active=true]:font-semibold"
                >
                  <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-2">
                    <FolderIcon />
                    <span className="min-w-0">
                      <span className="block truncate text-sm leading-5">{project.name}</span>
                      <span className="block text-xs font-normal text-muted">{project.boards.length} {project.boards.length === 1 ? "board" : "boards"}</span>
                    </span>
                  </div>
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

                <ul className="ml-5 grid list-none gap-1 border-l border-[var(--border)] py-1 pl-2">
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
                </ul>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <aside className="project-sidebar" aria-label="Kitten projects">
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
        <SearchField value={query} onChange={setQuery} aria-label="Search projects and boards" variant="secondary">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search projects and boards" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      <div className="project-sidebar-scroll">
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
