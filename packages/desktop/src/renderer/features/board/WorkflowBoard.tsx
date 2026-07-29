import { useState, type CSSProperties, type DragEvent as ReactDragEvent, type FormEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Alert, Button, Card, Chip, Dropdown, Input, Label, Modal, TextField } from "@heroui/react";
import type { WorkflowBoardProjection } from "../../../shared/rpc.ts";
import type {
  CardId,
  CardProjection,
  StageId,
  StageProjection,
} from "../../../workflow/workflowTypes.ts";
import { AlertIcon, DragHandleIcon, EditIcon, MoreIcon, PathIcon, PauseIcon, PlayIcon, SpinnerIcon, TrashIcon } from "../../components/Icons.tsx";
import { cardMovementAffordance } from "./boardInteractions.ts";
import {
  deriveImmediateSuccessorArrows,
  isCommittedOrderedPath,
  keyboardStageReorderIntent,
  orderedProjectedStages,
  pointerStageReorderIntent,
  type StageReorderIntent,
} from "./workflowCanvas.ts";

export type SetupMode = "choice" | "starter" | "manual";

interface BlankBoardSetupProps {
  readonly mode: SetupMode;
  readonly repositoryPath: string;
  readonly starterLabels: readonly string[];
  readonly busy: boolean;
  readonly onModeChange: (mode: SetupMode) => void;
  readonly onChooseRepository: () => void;
  readonly onStarterLabelChange: (index: number, label: string) => void;
  readonly onApplyStarter: () => void;
  readonly onCreateManual: () => void;
  readonly presentation?: "card" | "modal";
  readonly repositoryLocked?: boolean;
}

export function BlankBoardSetup({
  mode,
  repositoryPath,
  starterLabels,
  busy,
  onModeChange,
  onChooseRepository,
  onStarterLabelChange,
  onApplyStarter,
  onCreateManual,
  presentation = "card",
  repositoryLocked = false,
}: BlankBoardSetupProps) {
  const repositorySelected = repositoryPath.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repositorySelected) return;
    if (mode === "starter") onApplyStarter();
    if (mode === "manual") onCreateManual();
  }

  const content = (
    <>
        <div className="setup-choice" role="group" aria-label="Workflow setup path">
          <Button
            variant={mode === "starter" ? "primary" : "secondary"}
            aria-pressed={mode === "starter"}
            onPress={() => onModeChange("starter")}
            isDisabled={busy}
          >
            Edit starter workflow
          </Button>
          <Button
            variant={mode === "manual" ? "primary" : "secondary"}
            aria-pressed={mode === "manual"}
            onPress={() => onModeChange("manual")}
            isDisabled={busy}
          >
            Start empty
          </Button>
        </div>

        {mode === "choice" ? (
          <Alert status="default" className="notice">
            <Alert.Content>
              <Alert.Title>Choose a setup path</Alert.Title>
              <Alert.Description>The board will not change until you confirm its repository and stages.</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : (
          <form className="setup-form" onSubmit={submit} aria-busy={busy}>
            <div className="field">
              <Label id="repository-path-label">Trusted repository</Label>
              <div className="repository-picker" aria-busy={busy}>
                {repositoryLocked ? (
                  <div
                    className="repository-picker-value rounded-xl bg-[var(--surface-secondary)] px-4 py-3 text-sm text-foreground"
                    aria-labelledby="repository-path-label"
                    aria-describedby="repository-picker-help"
                  >
                    {repositoryPath}
                  </div>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      className="repository-picker-value"
                      aria-labelledby="repository-path-label"
                      aria-describedby="repository-picker-help"
                      onPress={onChooseRepository}
                      isDisabled={busy}
                    >
                      {repositoryPath.length === 0 ? "No folder selected" : repositoryPath}
                    </Button>
                    <Button type="button" variant="secondary" onPress={onChooseRepository} isDisabled={busy}>
                      {repositoryPath.length === 0 ? "Choose folder" : "Change folder"}
                    </Button>
                  </>
                )}
              </div>
              <p id="repository-picker-help" className="field-help">
                {repositoryLocked
                  ? "This board will be added to the selected project."
                  : "A project can contain multiple local workflow boards."}
              </p>
            </div>

            {mode === "starter" ? (
              <fieldset className="rounded-lg border border-separator p-4">
                <legend className="px-2 font-semibold">Starter stages</legend>
                <p className="field-help">Rename the stages now. Assign a validated Workflow Skill before starting work.</p>
                <ol className="starter-stages">
                  {starterLabels.map((label, index) => (
                    <li key={index}>
                      <TextField value={label} onChange={(value) => onStarterLabelChange(index, value)} isRequired isDisabled={busy}>
                        <Label className="sr-only">Stage {index + 1}</Label>
                        <Input variant="secondary" />
                      </TextField>
                    </li>
                  ))}
                </ol>
                <Button type="submit" className="mt-4" isDisabled={busy || !repositorySelected} isPending={busy}>
                  Create starter workflow
                </Button>
              </fieldset>
            ) : (
              <div className="grid gap-3">
                <p className="field-help">The board opens with no stages and immediately asks for the first stage.</p>
                <Button type="submit" className="justify-self-start" isDisabled={busy || !repositorySelected} isPending={busy}>
                  Create empty board
                </Button>
              </div>
            )}
          </form>
        )}
    </>
  );

  if (presentation === "modal") {
    return <div className="blank-board-content">{content}</div>;
  }

  return (
    <Card className="blank-board" aria-labelledby="blank-board-title">
      <Card.Header>
        <div>
          <p className="eyebrow">New project</p>
          <Card.Title id="blank-board-title">Set up this workflow board</Card.Title>
          <Card.Description>Choose a repository and start from an editable workflow or an empty board.</Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="blank-board-content">{content}</Card.Content>
    </Card>
  );
}

export function ProjectSetupModal({
  isOpen,
  onClose,
  context = "project",
  ...setup
}: BlankBoardSetupProps & {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly context?: "project" | "board";
}) {
  if (!isOpen) return null;

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(open) => !open && !setup.busy && onClose()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="max-h-[min(44rem,calc(100vh-2rem))]">
          <Modal.CloseTrigger isDisabled={setup.busy} />
          <Modal.Header>
            <div>
              <p className="eyebrow">{context === "board" ? "Existing project" : "New project"}</p>
              <Modal.Heading>{context === "board" ? "Add board" : "Set up this workflow board"}</Modal.Heading>
              <p className="field-help">
                {context === "board"
                  ? "Start another board in this repository from an editable workflow or an empty board."
                  : "Choose a repository and start from an editable workflow or an empty board."}
              </p>
            </div>
          </Modal.Header>
          <Modal.Body>
            <BlankBoardSetup {...setup} presentation="modal" repositoryLocked={context === "board"} />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

interface BoardCanvasProps {
  readonly projection: WorkflowBoardProjection;
  readonly selectedCardId: CardId | null;
  readonly busy: boolean;
  readonly onConfigureStage: (stage: StageProjection) => void;
  readonly onDeleteStage: (stage: StageProjection) => void;
  readonly onReorder: (intent: StageReorderIntent) => void;
  readonly onEditPath: () => void;
  readonly onMoveCard: (card: CardProjection, targetStageId: StageId) => void;
  readonly onSelectCard: (card: CardProjection) => void;
  readonly onStartCard?: (card: CardProjection) => void;
  readonly onStopCard?: (card: CardProjection) => void;
  readonly onDragStart: (stageId: StageId) => void;
  readonly onDragEnd: () => void;
  readonly draggedStageId: StageId | null;
}

function statusLabel(status: CardProjection["executionStatus"]): string {
  switch (status) {
    case "needs_attention":
      return "Attention required";
    case "ready_for_review":
      return "Ready for review";
    case "running":
      return "Running";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "idle":
      return "Idle";
  }
}

function statusColor(status: CardProjection["executionStatus"]): "default" | "accent" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "running") return "accent";
  if (status === "needs_attention" || status === "ready_for_review") return "warning";
  if (status === "failed" || status === "cancelled") return "danger";
  return "default";
}

function statusTone(status: CardProjection["executionStatus"]): string {
  if (status === "needs_attention") return "text-[var(--kitten-status-attention)]";
  if (status === "ready_for_review") return "text-[var(--kitten-status-review)]";
  if (status === "failed" || status === "cancelled") return "text-[var(--kitten-status-failure)]";
  if (status === "running") return "text-[var(--kitten-status-running)]";
  if (status === "completed") return "text-[var(--kitten-status-success)]";
  return "text-muted";
}

function cardKey(cardId: string): string {
  const tail = cardId.split(":").at(-1) ?? cardId;
  return tail.slice(0, 10).toLocaleUpperCase();
}

interface SortableStageColumnProps {
  readonly projection: WorkflowBoardProjection;
  readonly stage: StageProjection;
  readonly stageCards: readonly CardProjection[];
  readonly index: number;
  readonly stages: readonly StageProjection[];
  readonly selectedCardId: CardId | null;
  readonly busy: boolean;
  readonly successorLabel: string | null;
  readonly onConfigureStage: (stage: StageProjection) => void;
  readonly onDeleteStage: (stage: StageProjection) => void;
  readonly onReorder: (intent: StageReorderIntent) => void;
  readonly onEditPath: () => void;
  readonly onMoveCard: (card: CardProjection, targetStageId: StageId) => void;
  readonly onSelectCard: (card: CardProjection) => void;
  readonly onStartCard: (card: CardProjection) => void;
  readonly onStopCard: (card: CardProjection) => void;
  readonly draggedCard: CardProjection | null;
  readonly onCardDragStart: (card: CardProjection) => void;
  readonly onCardDragEnd: () => void;
}

function SortableStageColumn({
  projection,
  stage,
  stageCards,
  index,
  stages,
  selectedCardId,
  busy,
  successorLabel,
  onConfigureStage,
  onDeleteStage,
  onReorder,
  onEditPath,
  onMoveCard,
  onSelectCard,
  onStartCard,
  onStopCard,
  draggedCard,
  onCardDragStart,
  onCardDragEnd,
}: SortableStageColumnProps) {
  const board = projection.board!;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: stage.stageId, disabled: busy });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      id={`stage-${stage.stageId}`}
      style={style}
      data-dragging={isDragging}
      data-drop-target={isOver && !isDragging}
      className="stage-column relative data-[dragging=true]:border-dashed data-[dragging=true]:opacity-30 data-[drop-target=true]:ring-2 data-[drop-target=true]:ring-[var(--accent)] data-[drop-target=true]:ring-offset-2 data-[drop-target=true]:ring-offset-[var(--background)]"
      onDragOver={(event: ReactDragEvent<HTMLLIElement>) => {
        if (draggedCard === null) return;
        const movement = cardMovementAffordance(projection, draggedCard);
        if (movement.allowed && movement.targetStageId === stage.stageId) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event: ReactDragEvent<HTMLLIElement>) => {
        if (draggedCard === null) return;
        const movement = cardMovementAffordance(projection, draggedCard);
        if (!movement.allowed || movement.targetStageId !== stage.stageId) return;
        event.preventDefault();
        onMoveCard(draggedCard, stage.stageId);
        onCardDragEnd();
      }}
    >
      <header className="stage-header relative">
        <button
          type="button"
          className="absolute inset-0 z-0 cursor-grab touch-none rounded-[inherit] bg-transparent hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Drag ${stage.label} to reorder`}
          disabled={busy}
          {...attributes}
          {...listeners}
        >
          <span className="sr-only">Drag {stage.label} to reorder</span>
        </button>
        <div className="stage-header-title pointer-events-none relative min-w-0">
          <h3 className="truncate">{stage.label}</h3>
          <span className="stage-count" aria-label={`${stageCards.length} cards`}>{stageCards.length}</span>
        </div>
        <div className="relative z-10" aria-label={`Actions for ${stage.label}`}>
          <Dropdown>
            <Dropdown.Trigger
              aria-label={`Open actions for ${stage.label}`}
              className="grid size-8 place-items-center rounded-md text-muted hover:bg-[var(--surface-hover)] hover:text-foreground"
              isDisabled={busy}
            >
              <MoreIcon />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                aria-label={`Actions for ${stage.label}`}
                onAction={(key) => {
                  if (key === "edit") onConfigureStage(stage);
                  if (key === "delete") onDeleteStage(stage);
                  if (key === "path") onEditPath();
                  if (key === "previous") {
                    const intent = keyboardStageReorderIntent(board, stages, stage.stageId, "previous");
                    if (intent !== null) onReorder(intent);
                  }
                  if (key === "next") {
                    const intent = keyboardStageReorderIntent(board, stages, stage.stageId, "next");
                    if (intent !== null) onReorder(intent);
                  }
                }}
              >
                <Dropdown.Item id="edit" textValue="Edit stage"><EditIcon />Edit stage</Dropdown.Item>
                <Dropdown.Item id="delete" textValue="Remove empty stage" isDisabled={stageCards.length > 0}><TrashIcon />Remove stage</Dropdown.Item>
                <Dropdown.Item id="path" textValue="Edit workflow path"><PathIcon />Edit workflow path</Dropdown.Item>
                <Dropdown.Item id="previous" textValue="Move stage earlier" isDisabled={index === 0}>Move earlier</Dropdown.Item>
                <Dropdown.Item id="next" textValue="Move stage later" isDisabled={index === stages.length - 1}>Move later</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </header>

      <ul className="card-list" aria-label={`${stage.label} cards`}>
        {stageCards.map((card) => {
          const movement = cardMovementAffordance(projection, card);
          const selected = selectedCardId === card.cardId;
          return (
            <li key={card.cardId}>
              <Card
                id={`card-${card.cardId}`}
                draggable={movement.allowed && !busy}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", card.cardId);
                  onCardDragStart(card);
                }}
                onDragEnd={onCardDragEnd}
                className={`workflow-card relative${movement.allowed && !busy ? " cursor-grab active:cursor-grabbing" : ""}${selected ? " is-selected" : ""}${card.executionStatus === "needs_attention" ? " needs-attention" : ""}`}
                aria-label={`${card.title}, ${statusLabel(card.executionStatus)}`}
              >
                <button
                  id={`card-open-${card.cardId}`}
                  data-desktop-card-id={card.cardId}
                  type="button"
                  className="absolute inset-0 z-0 rounded-[inherit] bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2"
                  aria-pressed={selected}
                  onClick={() => onSelectCard(card)}
                  aria-label={`Open ${card.title}`}
                >
                  <span className="sr-only">Open {card.title}</span>
                </button>
                <span className="card-title pointer-events-none relative z-[1]">{card.title}</span>
                {card.description.trim().length === 0 ? null : <p className="card-description pointer-events-none relative z-[1]">{card.description}</p>}
                <div className="card-meta pointer-events-none relative z-[1]">
                  <span className="card-key">{cardKey(card.cardId)}</span>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={statusColor(card.executionStatus)}
                    className={statusTone(card.executionStatus)}
                  >
                    {card.executionStatus === "running" ? (
                      <span className="inline-flex items-center gap-1"><SpinnerIcon className="animate-spin motion-reduce:animate-none" />Running</span>
                    ) : statusLabel(card.executionStatus)}
                  </Chip>
                </div>
                <div className="card-actions relative z-10">
                  <span
                    className={`truncate text-xs ${card.skillOverrideId === null ? "font-semibold text-[var(--kitten-status-attention)]" : "text-muted"}`}
                  >
                    {card.skillOverrideId === null ? "Workflow Skill required" : `${card.provider} · ${card.model}`}
                  </span>
                  {card.executionStatus === "running" || card.executionStatus === "needs_attention" ? (
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      isDisabled={busy}
                      aria-label={`Stop ${card.title}`}
                      onPress={() => onStopCard(card)}
                    >
                      <PauseIcon />
                    </Button>
                  ) : (
                    <Button isIconOnly size="sm" variant="ghost" isDisabled={busy} aria-label={`Start ${card.title}`} onPress={() => onStartCard(card)}>
                      <PlayIcon />
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {successorLabel === null ? null : <span className="stage-arrow sr-only">Next stage: {successorLabel}</span>}
    </li>
  );
}

export function BoardCanvas({
  projection,
  selectedCardId,
  busy,
  onConfigureStage,
  onDeleteStage,
  onReorder,
  onEditPath,
  onMoveCard,
  onSelectCard,
  onStartCard = onSelectCard,
  onStopCard = () => {},
  onDragStart,
  onDragEnd,
  draggedStageId,
}: BoardCanvasProps) {
  const [draggedCard, setDraggedCard] = useState<CardProjection | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const board = projection.board;
  if (board === null) return null;
  const stages = orderedProjectedStages(projection.stages);
  const arrows = deriveImmediateSuccessorArrows(board, stages, projection.edges);
  const cardsByStage = new Map<StageId, CardProjection[]>();
  for (const card of projection.cards) {
    const cards = cardsByStage.get(card.stageId) ?? [];
    cards.push(card);
    cardsByStage.set(card.stageId, cards);
  }
  const activeStage = stages.find(({ stageId }) => stageId === draggedStageId) ?? null;

  function finishDrag(event: DragEndEvent) {
    const activeId = event.active.id as StageId;
    const overId = event.over?.id as StageId | undefined;
    onDragEnd();
    if (overId === undefined || activeId === overId) return;
    const activeIndex = stages.findIndex(({ stageId }) => stageId === activeId);
    const overIndex = stages.findIndex(({ stageId }) => stageId === overId);
    if (activeIndex < 0 || overIndex < 0) return;
    const intent = pointerStageReorderIntent(
      board!,
      stages,
      activeId,
      overId,
      activeIndex < overIndex ? "after" : "before",
    );
    if (intent !== null) onReorder(intent);
  }

  return (
    <section className="board-canvas" aria-labelledby="workflow-canvas-title">
      <header className="canvas-header">
        <h2 id="workflow-canvas-title">Workflow board</h2>
      </header>

      {!isCommittedOrderedPath(board, stages, projection.edges) && stages.length >= 2 ? (
        <Alert status="warning" className="mx-4 mb-2">
          <Alert.Indicator><AlertIcon /></Alert.Indicator>
          <Alert.Content>
            <Alert.Title>The stage path is not connected</Alert.Title>
            <Alert.Description>Connect every stage in one continuous path before running cards.</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="secondary" onPress={onEditPath} isDisabled={busy}>Connect path</Button>
        </Alert>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => onDragStart(active.id as StageId)}
        onDragCancel={onDragEnd}
        onDragEnd={finishDrag}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${stages.find(({ stageId }) => stageId === active.id)?.label ?? "stage"}.`,
            onDragOver: ({ over }) => over === null ? "Not over a stage." : `Over ${stages.find(({ stageId }) => stageId === over.id)?.label ?? "stage"}.`,
            onDragEnd: ({ active, over }) => over === null
              ? "Stage was not moved."
              : `Moved ${stages.find(({ stageId }) => stageId === active.id)?.label ?? "stage"} near ${stages.find(({ stageId }) => stageId === over.id)?.label ?? "stage"}.`,
            onDragCancel: () => "Stage move cancelled.",
          },
        }}
      >
        <SortableContext items={stages.map(({ stageId }) => stageId)} strategy={horizontalListSortingStrategy}>
          <ol className="stage-list" aria-label="Ordered workflow stages">
            {stages.map((stage, index) => (
              <SortableStageColumn
                key={stage.stageId}
                projection={projection}
                stage={stage}
                stageCards={cardsByStage.get(stage.stageId) ?? []}
                index={index}
                stages={stages}
                selectedCardId={selectedCardId}
                busy={busy}
                successorLabel={(() => {
                  const arrow = arrows.find(({ sourceStageId }) => sourceStageId === stage.stageId);
                  return arrow === undefined
                    ? null
                    : stages.find(({ stageId }) => stageId === arrow.targetStageId)?.label ?? null;
                })()}
                onConfigureStage={onConfigureStage}
                onDeleteStage={onDeleteStage}
                onReorder={onReorder}
                onEditPath={onEditPath}
                onMoveCard={onMoveCard}
                onSelectCard={onSelectCard}
                onStartCard={onStartCard}
                onStopCard={onStopCard}
                draggedCard={draggedCard}
                onCardDragStart={setDraggedCard}
                onCardDragEnd={() => setDraggedCard(null)}
              />
            ))}
          </ol>
        </SortableContext>
        <DragOverlay dropAnimation={{ duration: 160, easing: "ease-out" }}>
          {activeStage === null ? null : (
            <div className="w-64 rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-4 shadow-xl ring-2 ring-[var(--accent-soft)]">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]"><DragHandleIcon /></span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{activeStage.label}</p>
                  <p className="text-xs text-muted">{cardsByStage.get(activeStage.stageId)?.length ?? 0} cards · Moving stage</p>
                </div>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </section>
  );
}
