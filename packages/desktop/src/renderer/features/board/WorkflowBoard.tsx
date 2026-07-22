import type { DragEvent, FormEvent } from "react";
import { Alert, Button, Card, Chip, Input, Label, TextField } from "@heroui/react";
import type {
  WorkflowBoardProjection,
  WorkflowCatalogProjection,
} from "../../../shared/rpc.ts";
import type {
  CardId,
  CardProjection,
  StageId,
  StageProjection,
} from "../../../workflow/workflowTypes.ts";
import { AlertIcon, ArrowLeftIcon, ArrowRightIcon, PlayIcon, SettingsIcon } from "../../components/Icons.tsx";
import {
  cardMovementAffordance,
  stageConfigurationReason,
} from "./boardInteractions.ts";
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
}: BlankBoardSetupProps) {
  const repositorySelected = repositoryPath.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repositorySelected) return;
    if (mode === "starter") onApplyStarter();
    if (mode === "manual") onCreateManual();
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
      <Card.Content className="blank-board-content">
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
              </div>
              <p id="repository-picker-help" className="field-help">One repository owns one local workflow board.</p>
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
      </Card.Content>
    </Card>
  );
}

interface BoardCanvasProps {
  readonly projection: WorkflowBoardProjection;
  readonly catalog: WorkflowCatalogProjection;
  readonly selectedCardId: CardId | null;
  readonly busy: boolean;
  readonly onConfigureStage: (stage: StageProjection) => void;
  readonly onReorder: (intent: StageReorderIntent) => void;
  readonly onConnect: () => void;
  readonly onMoveCard: (card: CardProjection, targetStageId: StageId) => void;
  readonly onSelectCard: (card: CardProjection) => void;
  readonly onDragStart: (stageId: StageId) => void;
  readonly draggedStageId: StageId | null;
}

function statusLabel(status: CardProjection["executionStatus"]): string {
  return status.replaceAll("_", " ");
}

function statusColor(status: CardProjection["executionStatus"]): "default" | "accent" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "running") return "accent";
  if (status === "needs_attention" || status === "ready_for_review") return "warning";
  if (status === "failed" || status === "cancelled") return "danger";
  return "default";
}

function cardKey(cardId: string): string {
  const tail = cardId.split(":").at(-1) ?? cardId;
  return tail.slice(0, 10).toLocaleUpperCase();
}

export function BoardCanvas({
  projection,
  catalog,
  selectedCardId,
  busy,
  onConfigureStage,
  onReorder,
  onConnect,
  onMoveCard,
  onSelectCard,
  onDragStart,
  draggedStageId,
}: BoardCanvasProps) {
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
            <Alert.Description>Connect the ordered path before running cards.</Alert.Description>
          </Alert.Content>
          <Button size="sm" variant="secondary" onPress={onConnect} isDisabled={busy}>Connect path</Button>
        </Alert>
      ) : null}

      <ol className="stage-list" aria-label="Ordered workflow stages">
        {stages.map((stage, index) => {
          const configurationReason = stageConfigurationReason(stage, catalog);
          const nextArrow = arrows.find(({ sourceStageId }) => sourceStageId === stage.stageId);
          const stageCards = cardsByStage.get(stage.stageId) ?? [];
          return (
            <li
              key={stage.stageId}
              id={`stage-${stage.stageId}`}
              className="stage-column"
              draggable={!busy}
              onDragStart={() => onDragStart(stage.stageId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event: DragEvent<HTMLLIElement>) => {
                event.preventDefault();
                if (draggedStageId === null) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const placement = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
                const intent = pointerStageReorderIntent(board, stages, draggedStageId, stage.stageId, placement);
                if (intent !== null) onReorder(intent);
              }}
            >
              <header className="stage-header">
                <div className="stage-header-title">
                  <h3>{stage.label}</h3>
                  <span className="stage-count" aria-label={`${stageCards.length} cards`}>{stageCards.length}</span>
                </div>
                <div className="flex items-center gap-1" aria-label={`Reorder ${stage.label}`}>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${stage.label} earlier`}
                    isDisabled={busy || index === 0}
                    onPress={() => {
                      const intent = keyboardStageReorderIntent(board, stages, stage.stageId, "previous");
                      if (intent !== null) onReorder(intent);
                    }}
                  >
                    <ArrowLeftIcon />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={`Move ${stage.label} later`}
                    isDisabled={busy || index === stages.length - 1}
                    onPress={() => {
                      const intent = keyboardStageReorderIntent(board, stages, stage.stageId, "next");
                      if (intent !== null) onReorder(intent);
                    }}
                  >
                    <ArrowRightIcon />
                  </Button>
                </div>
              </header>

              {configurationReason === null ? null : (
                <div className="stage-settings">
                  <Button
                    size="sm"
                    variant="danger-soft"
                    fullWidth
                    onPress={() => onConfigureStage(stage)}
                    isDisabled={busy}
                    aria-label={`Configure ${stage.label}: ${configurationReason}`}
                  >
                    <SettingsIcon />Configure stage
                  </Button>
                </div>
              )}

              <ul className="card-list" aria-label={`${stage.label} cards`}>
                {stageCards.map((card) => {
                  const movement = cardMovementAffordance(projection, card);
                  const selected = selectedCardId === card.cardId;
                  return (
                    <li key={card.cardId}>
                      <Card
                        id={`card-${card.cardId}`}
                        tabIndex={-1}
                        className={`workflow-card${selected ? " is-selected" : ""}${card.executionStatus === "needs_attention" ? " needs-attention" : ""}`}
                        aria-label={`${card.title}, ${statusLabel(card.executionStatus)}`}
                      >
                        <Button
                          variant="ghost"
                          className="card-title-button"
                          aria-pressed={selected}
                          onPress={() => onSelectCard(card)}
                        >
                          <span className="card-title">{card.title}</span>
                        </Button>
                        {card.description.trim().length === 0 ? null : <p className="card-description">{card.description}</p>}
                        <div className="card-meta">
                          <span className="card-key">{cardKey(card.cardId)}</span>
                          <Chip size="sm" variant="soft" color={statusColor(card.executionStatus)}>
                            {statusLabel(card.executionStatus)}
                          </Chip>
                        </div>
                        <div className="card-actions">
                          <span className="truncate text-xs text-muted">{card.provider} · {card.model}</span>
                          {movement.targetStageId === null ? null : (
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              isDisabled={busy || !movement.allowed}
                              aria-label={movement.allowed ? `Move ${card.title} to next stage` : movement.reason}
                              onPress={() => onMoveCard(card, movement.targetStageId!)}
                            >
                              <PlayIcon />
                            </Button>
                          )}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>

              {nextArrow === undefined ? null : (
                <span className="stage-arrow sr-only">Next stage: {stages[index + 1]!.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
