import { useState } from "react";
import { Alert, Button, Skeleton } from "@heroui/react";
import type { DesktopRpcClient } from "../../client.ts";
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
  createBlankBoard,
  createCardCommand,
  createStageWithCatalogSkill,
  executeBoardCommand,
  moveCardCommand,
  reorderStagesCommand,
  setStagePathCommand,
  type CardEditInput,
  type CardCreateInput,
} from "./boardInteractions.ts";
import { BlankBoardSetup, BoardCanvas, ProjectSetupModal, type SetupMode } from "./WorkflowBoard.tsx";
import { ProjectSidebar } from "./ProjectSidebar.tsx";
import { StageSetupModal } from "./StageSetupModal.tsx";
import { CardInspector } from "../inspector/CardInspector.tsx";
import { AlertIcon, PlusIcon, TaskIcon } from "../../components/Icons.tsx";
import { useWorkflowBoardController } from "./useWorkflowBoardController.ts";
import { TaskCreateModal } from "./TaskCreateModal.tsx";
import { PathEditorModal } from "./PathEditorModal.tsx";

export function WorkflowBoard({ client }: { readonly client: DesktopRpcClient }) {
  const [setupMode, setSetupMode] = useState<SetupMode>("choice");
  const [starterLabels, setStarterLabels] = useState<readonly string[]>(STARTER_STAGE_LABELS);
  const [selectedCardId, setSelectedCardId] = useState<CardId | null>(null);
  const [draggedStageId, setDraggedStageId] = useState<StageId | null>(null);
  const [stageDialogMode, setStageDialogMode] = useState<"create" | "configure" | null>(null);
  const [stageBeingConfigured, setStageBeingConfigured] = useState<StageId | null>(null);
  const [stageLabel, setStageLabel] = useState("");
  const [stageSkillId, setStageSkillId] = useState<SkillId | null>(null);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [pathEditorBoardId, setPathEditorBoardId] = useState<string | null>(null);
  const controller = useWorkflowBoardController(client, {
    onBeginProjectSetup() {
      setSelectedCardId(null);
      setStageDialogMode(null);
      setSetupMode("choice");
      setPathEditorBoardId(null);
    },
    onSelectBoard() {
      setSelectedCardId(null);
      setStageDialogMode(null);
    },
  });
  const {
    projection,
    catalog,
    workspace,
    settings,
    loadError,
    busy,
    repositoryPath,
  } = controller;

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
          activeBoardId={controller.activeBoardId ?? null}
          busy={busy}
          onOpenProject={controller.openProject}
          onAddBoard={controller.addBoard}
          onSelectBoard={(boardId) => {
            setPathEditorBoardId(null);
            controller.selectBoard(boardId);
          }}
          onEditPath={(boardId) => {
            setPathEditorBoardId(boardId);
            controller.selectBoard(boardId);
          }}
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

  function runCommand(command: WorkflowCommand, onCommitted?: () => void) {
    controller.run(
      () => executeBoardCommand(client, command, controller.identities.current),
      onCommitted,
    );
  }

  function createTask(input: CardCreateInput) {
    const command = createCardCommand(currentProjection, input, controller.identities.current);
    if (command === null) return;
    runCommand(command, () => {
      setTaskCreateOpen(false);
      setSelectedCardId(command.cardId);
    });
  }

  function createStage(configured: boolean) {
    const execute = stageDialogMode === "configure" && stageBeingConfigured !== null && stageSkillId !== null
      ? () => assignCatalogSkillToStage(
          client,
          currentProjection,
          stageBeingConfigured,
          stageSkillId,
          currentCatalog,
          controller.identities.current,
        )
      : () => createStageWithCatalogSkill(
          client,
          currentProjection,
          stageLabel,
          configured ? stageSkillId : null,
          currentCatalog,
          controller.identities.current,
        );
    controller.run(execute, () => {
      setStageDialogMode(null);
      setStageBeingConfigured(null);
      setStageLabel("");
      setStageSkillId(null);
    });
  }

  return (
    <div className="desktop-workspace">
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={controller.boardMode === "new" ? null : controller.activeBoardId ?? projection.board?.boardId ?? null}
        busy={busy}
        onOpenProject={controller.openProject}
        onAddBoard={controller.addBoard}
        onSelectBoard={(boardId) => {
          setPathEditorBoardId(null);
          controller.selectBoard(boardId);
        }}
        onEditPath={(boardId) => {
          setPathEditorBoardId(boardId);
          controller.selectBoard(boardId);
        }}
      />
      <main className="app-shell board-page">
      <header className="app-header">
        <div className="app-header-copy">
          <p className="eyebrow">Workflow board</p>
          <h1>{projection.board === null ? "New project" : projection.board.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1)}</h1>
        </div>
      </header>

      {projection.board === null ? (
        <BlankBoardSetup
          mode={setupMode}
          repositoryPath={repositoryPath}
          starterLabels={starterLabels}
          busy={busy}
          onModeChange={setSetupMode}
          onChooseRepository={controller.chooseRepository}
          onStarterLabelChange={(index, label) => setStarterLabels((current) => current.map(
            (value, currentIndex) => currentIndex === index ? label : value,
          ))}
          onApplyStarter={() => controller.run(() => applyStarterTemplate(
            client,
            projection,
            repositoryPath,
            starterLabels,
            controller.identities.current,
          ))}
          onCreateManual={() => controller.run(() => createBlankBoard(
              client,
              projection,
              repositoryPath,
              controller.identities.current,
            ), () => setStageDialogMode("create"))}
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
              onPress={() => setTaskCreateOpen(true)}
              isDisabled={busy || projection.stages.length === 0}
              aria-label={projection.stages.length === 0 ? "Create task — add a stage first" : "Create task"}
            >
              <TaskIcon />Create task
            </Button>
            <Button
              size="sm"
              variant="secondary"
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
              onDragEnd={() => setDraggedStageId(null)}
              onConfigureStage={(stage) => {
                setStageDialogMode("configure");
                setStageBeingConfigured(stage.stageId);
                setStageLabel(stage.label);
                setStageSkillId(stage.defaultSkillId);
              }}
              onReorder={(intent) => runCommand(reorderStagesCommand(intent, controller.identities.current))}
              onEditPath={() => setPathEditorBoardId(projection.board?.boardId ?? null)}
              onMoveCard={(card, targetStageId) => {
                const command = moveCardCommand(projection, card, targetStageId, controller.identities.current);
                if (command !== null) runCommand(command);
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
                onSaveTask={(input: CardEditInput, onSaved) => {
                  const current = currentProjection.cards.find(({ cardId }) => cardId === selectedCard.cardId) ?? selectedCard;
                  controller.saveTask(current, input, onSaved);
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
          onCreate={createStage}
          onClose={() => {
            if (!busy) setStageDialogMode(null);
          }}
        />
      ) : null}
      {taskCreateOpen ? (
        <TaskCreateModal
          stages={projection.stages}
          catalog={catalog}
          profiles={settings?.profiles ?? []}
          providers={settings?.acpProviders ?? []}
          defaults={settings?.profileDefaults ?? {
            profileId: null,
            model: null,
            effort: null,
            appliesTo: "future_cards",
          }}
          busy={busy}
          onCreate={createTask}
          onClose={() => {
            if (!busy) setTaskCreateOpen(false);
          }}
        />
      ) : null}
      {projection.board !== null && pathEditorBoardId === projection.board.boardId ? (
        <PathEditorModal
          key={`${projection.board.boardId}:${projection.board.workflowVersion}`}
          projection={projection}
          busy={busy}
          onClose={() => setPathEditorBoardId(null)}
          onSave={(edges) => {
            const command = setStagePathCommand(projection, edges, controller.identities.current);
            if (command !== null) runCommand(command, () => setPathEditorBoardId(null));
          }}
        />
      ) : null}
      <ProjectSetupModal
        isOpen={controller.projectSetupOpen}
        context={workspace.boards.some(({ repositoryPath: existingPath }) => (
          existingPath.replace(/[\\/]+$/, "") === repositoryPath.replace(/[\\/]+$/, "")
        )) ? "board" : "project"}
        mode={setupMode}
        repositoryPath={repositoryPath}
        starterLabels={starterLabels}
        busy={busy}
        onModeChange={setSetupMode}
        onChooseRepository={controller.chooseRepository}
        onStarterLabelChange={(index, label) => setStarterLabels((current) => current.map(
          (value, currentIndex) => currentIndex === index ? label : value,
        ))}
        onApplyStarter={() => controller.run(() => applyStarterTemplate(
          client,
          projection,
          repositoryPath,
          starterLabels,
          controller.identities.current,
        ))}
        onCreateManual={() => controller.run(() => createBlankBoard(
          client,
          projection,
          repositoryPath,
          controller.identities.current,
        ), () => setStageDialogMode("create"))}
        onClose={controller.closeProjectSetup}
      />
      </main>
    </div>
  );
}
