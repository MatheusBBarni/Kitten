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
  PinIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
} from "../../components/Icons.tsx";

const PREFERENCES_KEY = "kitten:project-sidebar-preferences:v1";

interface ProjectPreference {
  readonly name?: string;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly hidden?: boolean;
}

type ProjectPreferences = Readonly<Record<string, ProjectPreference>>;

function readPreferences(): ProjectPreferences {
  try {
    if (typeof window === "undefined") return {};
    const stored = window.localStorage.getItem(PREFERENCES_KEY);
    if (stored === null) return {};
    const parsed = JSON.parse(stored) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ProjectPreferences
      : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences: ProjectPreferences): void {
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

function displayName(board: WorkspaceBoardSummary, preferences: ProjectPreferences): string {
  return preferences[board.boardId]?.name?.trim() || projectName(board.repositoryPath);
}

interface ProjectSidebarProps {
  readonly workspace: WorkspaceProjection;
  readonly activeBoardId: string | null;
  readonly busy: boolean;
  readonly onOpenProject: () => void;
  readonly onSelectBoard: (boardId: string) => void;
  readonly onOpenSettings?: () => void;
}

export function ProjectSidebar({
  workspace,
  activeBoardId,
  busy,
  onOpenProject,
  onSelectBoard,
  onOpenSettings,
}: ProjectSidebarProps) {
  const [preferences, setPreferences] = useState<ProjectPreferences>(readPreferences);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<WorkspaceBoardSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<WorkspaceBoardSummary | null>(null);

  useEffect(() => writePreferences(preferences), [preferences]);

  function updatePreference(boardId: string, patch: Partial<ProjectPreference>) {
    setPreferences((current) => ({
      ...current,
      [boardId]: { ...current[boardId], ...patch },
    }));
  }

  const visibleBoards = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return workspace.boards.filter((board) => {
      if (preferences[board.boardId]?.hidden) return false;
      if (normalizedQuery.length === 0) return true;
      return displayName(board, preferences).toLocaleLowerCase().includes(normalizedQuery)
        || board.repositoryPath.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [preferences, query, workspace.boards]);

  const pinned = visibleBoards.filter((board) => preferences[board.boardId]?.pinned && !preferences[board.boardId]?.archived);
  const projects = visibleBoards.filter((board) => !preferences[board.boardId]?.pinned && !preferences[board.boardId]?.archived);
  const archived = visibleBoards.filter((board) => preferences[board.boardId]?.archived);

  function group(label: string, boards: readonly WorkspaceBoardSummary[]) {
    if (boards.length === 0) return null;
    return (
      <section className="project-group" aria-labelledby={`project-group-${label.toLocaleLowerCase()}`}>
        <h3 id={`project-group-${label.toLocaleLowerCase()}`} className="project-group-title">{label}</h3>
        <ul className="project-list">
          {boards.map((board) => {
            const selected = board.boardId === activeBoardId;
            const preference = preferences[board.boardId] ?? {};
            return (
              <li key={board.boardId} className="project-item">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`project-row${selected ? " is-selected" : ""}`}
                  aria-current={selected ? "page" : undefined}
                  onPress={() => onSelectBoard(board.boardId)}
                  isDisabled={busy}
                >
                  <FolderIcon />
                  <span className="project-row-copy">
                    <span className="project-row-name">{displayName(board, preferences)}</span>
                    <span className="project-row-path">{board.repositoryPath}</span>
                  </span>
                </Button>
                <Dropdown>
                  <Dropdown.Trigger
                    aria-label={`Project actions for ${displayName(board, preferences)}`}
                    className="size-8 rounded-md text-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    isDisabled={busy}
                  >
                    <MoreIcon />
                  </Dropdown.Trigger>
                  <Dropdown.Popover placement="right top">
                    <Dropdown.Menu
                      aria-label={`Actions for ${displayName(board, preferences)}`}
                      onAction={(key) => {
                        if (key === "rename") {
                          setRenaming(board);
                          setRenameDraft(displayName(board, preferences));
                        }
                        if (key === "pin") updatePreference(board.boardId, { pinned: !preference.pinned, archived: false });
                        if (key === "archive") updatePreference(board.boardId, { archived: !preference.archived, pinned: false });
                        if (key === "delete") setDeleting(board);
                      }}
                    >
                      <Dropdown.Item id="rename" textValue="Rename project"><EditIcon />Rename</Dropdown.Item>
                      <Dropdown.Item id="pin" textValue={preference.pinned ? "Unpin project" : "Pin project"}>
                        <PinIcon />{preference.pinned ? "Unpin" : "Pin"}
                      </Dropdown.Item>
                      <Dropdown.Item id="archive" textValue={preference.archived ? "Unarchive project" : "Archive project"}>
                        <ArchiveIcon />{preference.archived ? "Unarchive" : "Archive"}
                      </Dropdown.Item>
                      <Dropdown.Item id="delete" variant="danger" textValue="Delete from sidebar">
                        <TrashIcon />Delete from sidebar
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
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
          <span className="project-sidebar-brand-mark" aria-hidden="true">K</span>
          <span>Kitten</span>
        </div>
      </header>

      <div className="project-sidebar-actions">
        <Button variant="ghost" size="sm" onPress={onOpenProject} isDisabled={busy}>
          <PlusIcon />Open project
        </Button>
        <SearchField value={query} onChange={setQuery} aria-label="Search projects" variant="secondary">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search projects" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      <div className="project-sidebar-scroll">
        {visibleBoards.length === 0 ? (
          <p className="project-sidebar-empty">
            {workspace.boards.length === 0 ? "Open a repository to create its workflow board." : "No projects match this search."}
          </p>
        ) : (
          <nav aria-label="Project boards">
            {group("Pinned", pinned)}
            {group("Projects", projects)}
            {group("Archived", archived)}
          </nav>
        )}
      </div>

      <footer className="project-sidebar-footer">
        <Button variant="ghost" size="sm" onPress={() => activeBoardId !== null && onSelectBoard(activeBoardId)} isDisabled={activeBoardId === null || busy}>
          <BoardIcon />Workflow board
        </Button>
        {onOpenSettings === undefined ? null : (
          <Button variant="ghost" size="sm" onPress={onOpenSettings}>
            <SettingsIcon />Settings
          </Button>
        )}
      </footer>

      <Modal.Backdrop isOpen={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Rename project</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField value={renameDraft} onChange={setRenameDraft} autoFocus isRequired>
                <Label>Project name</Label>
                <Input variant="secondary" />
              </TextField>
              <p className="field-help">This changes the sidebar label only. The repository folder is not renamed.</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => setRenaming(null)}>Cancel</Button>
              <Button
                onPress={() => {
                  if (renaming === null || renameDraft.trim().length === 0) return;
                  updatePreference(renaming.boardId, { name: renameDraft.trim() });
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
              <AlertDialog.Heading>Delete this project from the sidebar?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              The repository and its durable workflow history stay on disk. You can reopen the folder later.
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="secondary" onPress={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                onPress={() => {
                  if (deleting === null) return;
                  updatePreference(deleting.boardId, { hidden: true, pinned: false, archived: false });
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
