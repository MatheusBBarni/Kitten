import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Drawer, Skeleton } from "@heroui/react";
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
  deleteStageCommand,
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
import { AlertIcon, BoardIcon, PlusIcon, TaskIcon } from "../../components/Icons.tsx";
import { useWorkflowBoardController } from "./useWorkflowBoardController.ts";
import { TaskCreateModal } from "./TaskCreateModal.tsx";
import { PathEditorModal } from "./PathEditorModal.tsx";
import { useTaskRunControls } from "./useTaskRunControls.ts";
import {
  useDesktopViewStore,
  type BoardReference,
  type WorkbenchSelection,
} from "../../state/desktopViewStore.ts";
import {
  workInboxItemFocusId,
  type WorkInboxSelection,
} from "./ProjectSidebar.tsx";
import { useResponsiveShellMode } from "./useResponsiveShellMode.ts";

export function WorkflowBoard({ client }: { readonly client: DesktopRpcClient }) {
  const [setupMode, setSetupMode] = useState<SetupMode>("choice");
  const [starterLabels, setStarterLabels] = useState<readonly string[]>(STARTER_STAGE_LABELS);
  const [draggedStageId, setDraggedStageId] = useState<StageId | null>(null);
  const [stageDialogMode, setStageDialogMode] = useState<"create" | "configure" | null>(null);
  const [stageBeingConfigured, setStageBeingConfigured] = useState<StageId | null>(null);
  const [stageLabel, setStageLabel] = useState("");
  const [stageSkillId, setStageSkillId] = useState<SkillId | null>(null);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [pathEditorBoardId, setPathEditorBoardId] = useState<string | null>(null);
  const [narrowNavigationOpen, setNarrowNavigationOpen] = useState(false);
  const boardWorkspaceRef = useRef<HTMLDivElement>(null);
  const shellMode = useResponsiveShellMode();
  const workbenchMode = useDesktopViewStore((state) => state.workbenchMode);
  const selectedCardReference = useDesktopViewStore((state) => state.selectedCard);
  const pendingBoardReturn = useDesktopViewStore((state) => state.pendingBoardReturn);
  const openWorkbench = useDesktopViewStore((state) => state.openWorkbench);
  const setWorkbenchMode = useDesktopViewStore((state) => state.setWorkbenchMode);
  const closeWorkbench = useDesktopViewStore((state) => state.closeWorkbench);
  const dismissWorkbench = useDesktopViewStore((state) => state.dismissWorkbench);
  const setInitialBoard = useDesktopViewStore((state) => state.setInitialBoard);
  const setActiveBoardContext = useDesktopViewStore((state) => state.setActiveBoardContext);
  const reconcileBoardReferences = useDesktopViewStore((state) => state.reconcileBoardReferences);
  const acknowledgeBoardReturn = useDesktopViewStore((state) => state.acknowledgeBoardReturn);
  const controller = useWorkflowBoardController(client, {
    onBeginProjectSetup() {
      dismissWorkbench();
      setStageDialogMode(null);
      setSetupMode("choice");
      setPathEditorBoardId(null);
    },
    onSelectBoard() {
      dismissWorkbench();
      setStageDialogMode(null);
    },
  });
  const runControls = useTaskRunControls(client);
  const {
    projection,
    catalog,
    workspace,
    workInbox,
    settings,
    loadError,
    busy,
    repositoryPath,
  } = controller;
  const boardReferences: BoardReference[] = workspace.boards.map((board) => ({
    repositoryKey: board.repositoryPath,
    boardId: board.boardId,
  }));
  if (
    projection?.board !== null
    && projection?.board !== undefined
    && !boardReferences.some(({ boardId }) => boardId === projection.board?.boardId)
  ) {
    boardReferences.push({
      repositoryKey: projection.board.repositoryPath,
      boardId: projection.board.boardId,
    });
  }

  useEffect(() => {
    if (projection?.board !== null && projection?.board !== undefined) {
      setInitialBoard(projection.board.boardId);
      setActiveBoardContext(projection.board.repositoryPath, projection.board.boardId);
    }
  }, [projection?.board, setActiveBoardContext, setInitialBoard]);

  useEffect(() => {
    if (workbenchMode === "closed") return;
    const responsiveMode = shellMode === "narrow" ? "narrow" : "desktop";
    if (workbenchMode !== responsiveMode) setWorkbenchMode(responsiveMode);
  }, [setWorkbenchMode, shellMode, workbenchMode]);

  useEffect(() => {
    reconcileBoardReferences({
      boards: boardReferences,
      loadedBoardId: projection?.board?.boardId ?? null,
      loadedCardIds: projection?.cards.map(({ cardId }) => cardId) ?? [],
    });
  }, [projection, reconcileBoardReferences, workspace]);

  useLayoutEffect(() => {
    if (
      pendingBoardReturn === null
      || projection?.board?.boardId !== pendingBoardReturn.boardId
    ) return;
    const stageList = boardWorkspaceRef.current?.querySelector<HTMLElement>(".stage-list");
    if (stageList !== null && stageList !== undefined) {
      stageList.scrollLeft = pendingBoardReturn.anchor.scrollLeft;
      stageList.scrollTop = pendingBoardReturn.anchor.scrollTop;
    }
    if (pendingBoardReturn.focusTargetId !== null) {
      document.getElementById(pendingBoardReturn.focusTargetId)?.focus();
    }
    acknowledgeBoardReturn();
  }, [acknowledgeBoardReturn, pendingBoardReturn, projection?.board?.boardId]);

  function selectBoardFromNavigation(boardId: string) {
    setNarrowNavigationOpen(false);
    setPathEditorBoardId(null);
    controller.selectBoard(boardId);
  }

  function editBoardPathFromNavigation(boardId: string) {
    setNarrowNavigationOpen(false);
    setPathEditorBoardId(boardId);
    controller.selectBoard(boardId);
  }

  function renderProjectNavigation() {
    return (
      <ProjectSidebar
        workspace={workspace}
        activeBoardId={
          controller.boardMode === "new"
            ? null
            : controller.activeBoardId ?? projection?.board?.boardId ?? null
        }
        busy={busy}
        workInbox={workInbox}
        selectedInboxItem={selectedCardReference}
        onSelectInboxItem={(selection) => {
          setNarrowNavigationOpen(false);
          openInboxItem(selection);
        }}
        onOpenProject={() => {
          setNarrowNavigationOpen(false);
          controller.openProject();
        }}
        onAddBoard={controller.addBoard}
        onSelectBoard={selectBoardFromNavigation}
        onEditPath={editBoardPathFromNavigation}
      />
    );
  }

  function renderNarrowNavigation() {
    return (
      <Drawer.Backdrop
        isOpen={narrowNavigationOpen}
        onOpenChange={setNarrowNavigationOpen}
      >
        <Drawer.Content placement="left">
          <Drawer.Dialog
            aria-label="Repository navigation"
            className="h-dvh w-[min(22rem,calc(100vw-2rem))] max-w-none rounded-none bg-[var(--kitten-surface-navigation)]"
          >
            <Drawer.CloseTrigger aria-label="Close repository navigation" />
            <Drawer.Body className="min-h-0 p-0">
              {renderProjectNavigation()}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    );
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
      <div
        data-shell-layout={shellMode}
        data-workbench-mode={workbenchMode}
        className={`grid h-dvh min-w-0 overflow-hidden bg-[var(--kitten-surface-canvas)] ${
          shellMode === "wide"
            ? "grid-cols-[var(--kitten-sidebar-width)_minmax(0,1fr)]"
            : "grid-cols-[minmax(0,1fr)]"
        }`}
      >
        {shellMode === "wide" ? renderProjectNavigation() : renderNarrowNavigation()}
        <main aria-busy="true" className="app-shell min-w-0 p-4">
          {shellMode === "narrow" ? (
            <Button
              size="sm"
              variant="secondary"
              className="mb-3"
              onPress={() => setNarrowNavigationOpen(true)}
            >
              <BoardIcon />Projects
            </Button>
          ) : null}
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
  const selectedCardId = selectedCardReference !== null
    && selectedCardReference.boardId === projection.board?.boardId
      ? selectedCardReference.cardId as CardId
      : null;
  const selectedCard = projection.cards.find(({ cardId }) => cardId === selectedCardId) ?? null;
  const currentProjection = projection;
  const currentCatalog = catalog;

  function openCard(card: {
    readonly cardId: CardId;
    readonly boardId: string;
    readonly stageId: StageId;
  }) {
    const board = currentProjection.board;
    if (board === null) return;
    const stageList = boardWorkspaceRef.current?.querySelector<HTMLElement>(".stage-list");
    const target: WorkbenchSelection = {
      repositoryKey: board.repositoryPath,
      boardId: card.boardId,
      cardId: card.cardId,
    };
    openWorkbench({
      target,
      mode: shellMode === "narrow" ? "narrow" : "desktop",
      origin: {
        repositoryKey: board.repositoryPath,
        boardId: board.boardId,
        boardMode: controller.boardMode,
        anchor: {
          stageId: card.stageId,
          cardId: card.cardId,
          scrollLeft: stageList?.scrollLeft ?? 0,
          scrollTop: stageList?.scrollTop ?? 0,
        },
        focusTargetId: `card-open-${card.cardId}`,
      },
    });
  }

  function openInboxItem(selection: WorkInboxSelection) {
    const currentBoard = projection?.board ?? null;
    const targetRepository = selection.repositoryPath.length > 0
      ? selection.repositoryPath
      : workspace.boards.find(({ boardId }) => boardId === selection.item.boardId)?.repositoryPath;
    if (targetRepository === undefined) return;
    const stageList = boardWorkspaceRef.current?.querySelector<HTMLElement>(".stage-list");
    const originCardId = selectedCardReference !== null
      && selectedCardReference.boardId === currentBoard?.boardId
      ? selectedCardReference.cardId
      : null;
    const originCard = originCardId !== null
      ? projection?.cards.find(({ cardId }) => cardId === originCardId)
      : undefined;
    const origin = currentBoard === null
      ? {
          repositoryKey: targetRepository,
          boardId: selection.item.boardId,
          boardMode: "active" as const,
          anchor: {
            stageId: null,
            cardId: null,
            scrollLeft: 0,
            scrollTop: 0,
          },
          focusTargetId: workInboxItemFocusId(selection.item.boardId, selection.item.cardId),
        }
      : {
          repositoryKey: currentBoard.repositoryPath,
          boardId: currentBoard.boardId,
          boardMode: controller.boardMode,
          anchor: {
            stageId: originCard?.stageId ?? null,
            cardId: originCard?.cardId ?? null,
            scrollLeft: stageList?.scrollLeft ?? 0,
            scrollTop: stageList?.scrollTop ?? 0,
          },
          focusTargetId: workInboxItemFocusId(selection.item.boardId, selection.item.cardId),
        };
    openWorkbench({
      target: {
        repositoryKey: targetRepository,
        boardId: selection.item.boardId,
        cardId: selection.item.cardId,
      },
      attemptId: selection.item.attemptId,
      mode: shellMode === "narrow" ? "narrow" : "desktop",
      origin,
    });
  }

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
      openCard({ cardId: command.cardId, boardId: command.boardId, stageId: command.stageId });
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
    <div
      data-shell-layout={shellMode}
      data-workbench-mode={workbenchMode}
      className={`grid h-dvh min-w-0 overflow-hidden bg-[var(--kitten-surface-canvas)] ${
        shellMode === "wide"
          ? workbenchMode === "closed"
            ? "grid-cols-[var(--kitten-sidebar-width)_minmax(0,1fr)]"
            : "grid-cols-[var(--kitten-sidebar-width)_minmax(20rem,1fr)_minmax(28rem,var(--kitten-workbench-width))]"
          : "grid-cols-[minmax(0,1fr)]"
      }`}
    >
      {shellMode === "wide" ? renderProjectNavigation() : renderNarrowNavigation()}
      <main
        className={`app-shell board-page min-w-0 ${
          shellMode === "narrow" && workbenchMode !== "closed" ? "hidden" : ""
        }`}
        aria-label="Kanban board"
        hidden={shellMode === "narrow" && workbenchMode !== "closed"}
      >
      <header className="app-header">
        <div className="app-header-copy">
          <p className="eyebrow">Workflow board</p>
          <h1 id="board-main-heading" tabIndex={-1}>{projection.board === null ? "New project" : projection.board.repositoryPath.split(/[\\/]/).filter(Boolean).at(-1)}</h1>
        </div>
        {shellMode === "narrow" ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => setNarrowNavigationOpen(true)}
          >
            <BoardIcon />Projects
          </Button>
        ) : null}
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
              <Button size="sm" variant="danger-soft" onPress={() => openCard(attentionCard)}>
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

          <div className="board-workspace" ref={boardWorkspaceRef}>
            <BoardCanvas
              projection={projection}
              catalog={catalog}
              selectedCardId={selectedCardId}
              busy={busy || runControls.busy}
              draggedStageId={draggedStageId}
              onDragStart={setDraggedStageId}
              onDragEnd={() => setDraggedStageId(null)}
              onConfigureStage={(stage) => {
                setStageDialogMode("configure");
                setStageBeingConfigured(stage.stageId);
                setStageLabel(stage.label);
                setStageSkillId(stage.defaultSkillId);
              }}
              onDeleteStage={(stage) => {
                const command = deleteStageCommand(projection, stage, controller.identities.current);
                if (command !== null) runCommand(command);
              }}
              onReorder={(intent) => runCommand(reorderStagesCommand(intent, controller.identities.current))}
              onEditPath={() => setPathEditorBoardId(projection.board?.boardId ?? null)}
              onMoveCard={(card, targetStageId) => {
                const command = moveCardCommand(projection, card, targetStageId, controller.identities.current);
                if (command !== null) runCommand(command);
              }}
              onSelectCard={(card) => {
                openCard(card);
              }}
              onStartCard={(card) => {
                openCard(card);
                runControls.start(card);
              }}
              onStopCard={runControls.stop}
            />
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
      {selectedCard !== null && workbenchMode !== "closed" && projection.board !== null ? (
        <CardInspector
          key={selectedCard.cardId}
          client={client}
          card={selectedCard}
          repositoryKey={projection.board.repositoryPath}
          presentation={workbenchMode}
          isOpen
          taskBusy={busy}
          onOpenChange={(open) => {
            if (!open) closeWorkbench(boardReferences);
          }}
          onSaveTask={(input: CardEditInput, onSaved) => {
            const current = currentProjection.cards.find(({ cardId }) => cardId === selectedCard.cardId) ?? selectedCard;
            controller.saveTask(current, input, onSaved);
          }}
        />
      ) : null}
    </div>
  );
}
