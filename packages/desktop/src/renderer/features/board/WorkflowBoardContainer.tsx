import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Chip, Skeleton } from "@heroui/react";
import type { DesktopRpcClient } from "../../client.ts";
import { bindWorkflowBoardRenderer } from "../../client.ts";
import type {
  WorkflowBoardProjection,
  WorkflowCatalogProjection,
  WorkspaceProjection,
} from "../../../shared/rpc.ts";
import { createEmptyWorkspaceProjection } from "../../../shared/rpc.ts";
import type {
  CardId,
  SkillId,
  StageId,
  WorkflowCommand,
} from "../../../workflow/workflowTypes.ts";
import {
  STARTER_STAGE_LABELS,
  applyStarterTemplate,
  assignCatalogSkillToStage,
  boardInteractionMessage,
  connectStagesCommand,
  createBlankBoard,
  createBrowserIdentityFactory,
  createStageWithCatalogSkill,
  executeBoardCommand,
  moveCardCommand,
  reorderStagesCommand,
  updateCardCommand,
  type CardEditInput,
  type BoardInteractionResult,
  type IdentityFactory,
} from "./boardInteractions.ts";
import { BlankBoardSetup, BoardCanvas, type SetupMode } from "./WorkflowBoard.tsx";
import { ProjectSidebar } from "./ProjectSidebar.tsx";
import { StageSetupModal } from "./StageSetupModal.tsx";
import { CardInspector } from "../inspector/CardInspector.tsx";
import { AlertIcon, PlusIcon } from "../../components/Icons.tsx";

interface Feedback {
  readonly message: string;
  readonly tone: "status" | "error";
}

export function WorkflowBoard({
  client,
  onOpenSettings,
}: {
  readonly client: DesktopRpcClient;
  readonly onOpenSettings?: () => void;
}) {
  const identities = useRef<IdentityFactory>(createBrowserIdentityFactory());
  const [projection, setProjection] = useState<WorkflowBoardProjection | null>(null);
  const [catalog, setCatalog] = useState<WorkflowCatalogProjection | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceProjection>(createEmptyWorkspaceProjection);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupMode, setSetupMode] = useState<SetupMode>("choice");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [starterLabels, setStarterLabels] = useState<readonly string[]>(STARTER_STAGE_LABELS);
  const [selectedCardId, setSelectedCardId] = useState<CardId | null>(null);
  const [draggedStageId, setDraggedStageId] = useState<StageId | null>(null);
  const [stageDialogMode, setStageDialogMode] = useState<"create" | "configure" | null>(null);
  const [stageBeingConfigured, setStageBeingConfigured] = useState<StageId | null>(null);
  const [stageLabel, setStageLabel] = useState("");
  const [stageSkillId, setStageSkillId] = useState<SkillId | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | undefined>(undefined);
  const [boardMode, setBoardMode] = useState<"active" | "new">("active");

  useEffect(() => {
    const binding = bindWorkflowBoardRenderer(client, {
      onBoard(envelope) {
        if (envelope.result.status === "ok") {
          setProjection(envelope.result.projection);
          setLoadError(null);
          if (
            boardMode === "active"
            && activeBoardId === undefined
            && envelope.result.projection.board !== null
          ) {
            setActiveBoardId(envelope.result.projection.board.boardId);
          }
        } else {
          setLoadError("The Workflow Board projection is unavailable. Wait for the desktop host to reconnect.");
        }
      },
      onCatalog(envelope) {
        if (envelope.result.status === "ok") {
          setCatalog(envelope.result.projection);
        } else {
          setLoadError("The local Skill Catalog is unavailable. Stage setup cannot continue.");
        }
      },
      onWorkspace(envelope) {
        if (envelope.result.status === "ok") setWorkspace(envelope.result.projection);
      },
    }, { boardId: activeBoardId, mode: boardMode });
    return () => binding.dispose();
  }, [activeBoardId, boardMode, client]);

  const applyResult = useCallback((result: BoardInteractionResult): boolean => {
    const message = boardInteractionMessage(result);
    setFeedback({
      message: message ?? "Board projection committed.",
      tone: result.status === "ok" ? "status" : "error",
    });
    if (result.status !== "ok") return false;
    setProjection(result.projection);
    if (boardMode === "new" && result.projection.board !== null) {
      setActiveBoardId(result.projection.board.boardId);
      setBoardMode("active");
    }
    return true;
  }, [boardMode]);

  const run = useCallback(async (action: () => Promise<BoardInteractionResult>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      return applyResult(await action());
    } catch {
      setFeedback({
        message: "The desktop host did not finish this action. Review the current board and try again.",
        tone: "error",
      });
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyResult, busy]);

  const chooseRepository = useCallback(async () => {
    if (busy) return;
    if (client.pickRepositoryDirectory === undefined) {
      setFeedback({
        message: "Folder selection is not available. Restart the desktop app and try again.",
        tone: "error",
      });
      return;
    }
    setBusy(true);
    try {
      const envelope = await client.pickRepositoryDirectory();
      if (envelope.result.status === "selected") {
        setRepositoryPath(envelope.result.path);
        setFeedback({ message: "Repository folder selected.", tone: "status" });
      } else if (envelope.result.status === "unavailable") {
        setFeedback({
          message: "Couldn't open the folder picker. Restart the desktop app and try again.",
          tone: "error",
        });
      } else {
        setFeedback({ message: "Folder selection cancelled.", tone: "status" });
      }
    } catch {
      setFeedback({
        message: "Couldn't open the folder picker. Restart the desktop app and try again.",
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, client]);

  function openProject() {
    if (busy) return;
    setActiveBoardId(undefined);
    setBoardMode("new");
    setProjection(null);
    setSelectedCardId(null);
    setStageDialogMode(null);
    setSetupMode("choice");
    setRepositoryPath("");
    setFeedback(null);
    void chooseRepository();
  }

  function selectBoard(boardId: string) {
    if (busy || boardId === activeBoardId) return;
    setActiveBoardId(boardId);
    setBoardMode("active");
    setSelectedCardId(null);
    setStageDialogMode(null);
    setFeedback(null);
  }

  if (loadError !== null) {
    return (
      <main role="alert" className="app-shell grid place-items-center p-6">
        <Alert status="danger" className="max-w-xl">
          <Alert.Indicator><AlertIcon /></Alert.Indicator>
          <Alert.Content>
            <Alert.Title>Workflow board unavailable</Alert.Title>
            <Alert.Description>{loadError}</Alert.Description>
          </Alert.Content>
        </Alert>
      </main>
    );
  }
  if (projection === null || catalog === null) {
    return (
      <div className="desktop-workspace">
        <ProjectSidebar
          workspace={workspace}
          activeBoardId={activeBoardId ?? null}
          busy={busy}
          onOpenProject={openProject}
          onSelectBoard={selectBoard}
          onOpenSettings={onOpenSettings}
        />
        <main aria-busy="true" className="app-shell p-4">
          <Skeleton className="mb-3 h-16 w-full rounded-lg" />
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[70vh] w-64 rounded-lg" />)}
          </div>
          <span className="sr-only">Loading workflow board…</span>
        </main>
      </div>
    );
  }

  const attentionCard = projection.cards.find(({ executionStatus }) => executionStatus === "needs_attention") ?? null;
  const selectedCard = projection.cards.find(({ cardId }) => cardId === selectedCardId) ?? null;
  const currentProjection = projection;
  const currentCatalog = catalog;

  async function runCommand(command: WorkflowCommand) {
    await run(() => executeBoardCommand(client, command, identities.current));
  }

  async function createStage(configured: boolean) {
    const success = stageDialogMode === "configure" && stageBeingConfigured !== null && stageSkillId !== null
      ? await run(() => assignCatalogSkillToStage(
          client,
          currentProjection,
          stageBeingConfigured,
          stageSkillId,
          currentCatalog,
          identities.current,
        ))
      : await run(() => createStageWithCatalogSkill(
          client,
          currentProjection,
          stageLabel,
          configured ? stageSkillId : null,
          currentCatalog,
          identities.current,
        ));
    if (success) {
      setStageDialogMode(null);
      setStageBeingConfigured(null);
      setStageLabel("");
      setStageSkillId(null);
    }
  }

  return (
    <div className="desktop-workspace">
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={boardMode === "new" ? null : activeBoardId ?? projection.board?.boardId ?? null}
        busy={busy}
        onOpenProject={openProject}
        onSelectBoard={selectBoard}
        onOpenSettings={onOpenSettings}
      />
      <main className="app-shell board-page">
      <header className="app-header">
        <div className="app-header-copy">
          <p className="eyebrow">Workflow board</p>
          <h1>{projection.board === null ? "New project" : projection.board.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1)}</h1>
        </div>
        <div className="app-header-meta">
          {projection.board === null ? null : <span className="hidden max-w-[28rem] truncate lg:inline">{projection.board.repositoryPath}</span>}
          <Chip size="sm" variant="soft">Revision {projection.revision}</Chip>
        </div>
      </header>

      {feedback !== null ? (
        <div className="board-feedback">
        <Alert
          className="notice"
          status={feedback.tone === "status" ? "success" : "danger"}
          role={feedback.tone === "status" ? "status" : "alert"}
        >
          <Alert.Content><Alert.Description>{feedback.message}</Alert.Description></Alert.Content>
        </Alert>
        </div>
      ) : null}

      {projection.board === null ? (
        <BlankBoardSetup
          mode={setupMode}
          repositoryPath={repositoryPath}
          starterLabels={starterLabels}
          busy={busy}
          onModeChange={setSetupMode}
          onChooseRepository={() => void chooseRepository()}
          onStarterLabelChange={(index, label) => setStarterLabels((current) => current.map(
            (value, currentIndex) => currentIndex === index ? label : value,
          ))}
          onApplyStarter={() => void run(() => applyStarterTemplate(
            client,
            projection,
            repositoryPath,
            starterLabels,
            identities.current,
          ))}
          onCreateManual={() => void (async () => {
            const created = await run(() => createBlankBoard(
              client,
              projection,
              repositoryPath,
              identities.current,
            ));
            if (created) setStageDialogMode("create");
          })()}
        />
      ) : (
        <>
          <nav className="board-toolbar" aria-label="Board actions">
            {attentionCard !== null ? (
              <Button size="sm" variant="danger-soft" onPress={() => setSelectedCardId(attentionCard.cardId)}>
                <AlertIcon />Open attention task
              </Button>
            ) : null}
            <Button
              size="sm"
              onPress={() => {
                setStageDialogMode("create");
                setStageBeingConfigured(null);
                setStageLabel("");
                setStageSkillId(null);
              }}
              isDisabled={busy}
            >
              <PlusIcon />Add stage
            </Button>
          </nav>

          <div className="board-workspace">
            <BoardCanvas
              projection={projection}
              catalog={catalog}
              selectedCardId={selectedCardId}
              busy={busy}
              draggedStageId={draggedStageId}
              onDragStart={setDraggedStageId}
              onConfigureStage={(stage) => {
                setStageDialogMode("configure");
                setStageBeingConfigured(stage.stageId);
                setStageLabel(stage.label);
                setStageSkillId(stage.defaultSkillId);
              }}
              onReorder={(intent) => void runCommand(reorderStagesCommand(intent, identities.current))}
              onConnect={() => {
                const command = connectStagesCommand(projection, identities.current);
                if (command !== null) void runCommand(command);
              }}
              onMoveCard={(card, targetStageId) => {
                const command = moveCardCommand(projection, card, targetStageId, identities.current);
                if (command !== null) void runCommand(command);
              }}
              onSelectCard={(card) => {
                setSelectedCardId(card.cardId);
              }}
            />
            {selectedCard !== null ? (
              <CardInspector
                key={selectedCard.cardId}
                client={client}
                card={selectedCard}
                isOpen
                taskBusy={busy}
                onOpenChange={(open) => {
                  if (!open) setSelectedCardId(null);
                }}
                onSaveTask={async (input: CardEditInput) => {
                  const current = currentProjection.cards.find(({ cardId }) => cardId === selectedCard.cardId) ?? selectedCard;
                  const command = updateCardCommand(current, input, identities.current);
                  if (command === null) {
                    setFeedback({ message: "Title, provider, model, and effort are required.", tone: "error" });
                    return false;
                  }
                  return run(() => executeBoardCommand(client, command, identities.current));
                }}
              />
            ) : null}
          </div>
        </>
      )}

      {stageDialogMode !== null ? (
        <StageSetupModal
          mode={stageDialogMode}
          catalog={catalog}
          label={stageLabel}
          selectedSkillId={stageSkillId}
          busy={busy}
          onLabelChange={setStageLabel}
          onSkillChange={setStageSkillId}
          onCreate={(configured) => void createStage(configured)}
          onClose={() => {
            if (!busy) setStageDialogMode(null);
          }}
        />
      ) : null}
      </main>
    </div>
  );
}
