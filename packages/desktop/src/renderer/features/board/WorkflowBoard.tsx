import type { DragEvent, FormEvent } from "react";
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
  readonly onRepositoryPathChange: (path: string) => void;
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
  onRepositoryPathChange,
  onStarterLabelChange,
  onApplyStarter,
  onCreateManual,
}: BlankBoardSetupProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "starter") onApplyStarter();
    if (mode === "manual") onCreateManual();
  }

  return (
    <section className="blank-board" aria-labelledby="blank-board-title">
      <p className="eyebrow">Blank Workflow Board</p>
      <h2 id="blank-board-title">Choose how to set up the workflow</h2>
      <p>
        Nothing is added until you choose a setup path. Existing workflows are never replaced by this screen.
      </p>

      <div className="setup-choice" role="group" aria-label="Workflow setup path">
        <button
          type="button"
          className="button button-primary"
          aria-pressed={mode === "starter"}
          onClick={() => onModeChange("starter")}
          disabled={busy}
        >
          Edit starter template
        </button>
        <button
          type="button"
          className="button button-secondary"
          aria-pressed={mode === "manual"}
          onClick={() => onModeChange("manual")}
          disabled={busy}
        >
          Set up manually
        </button>
      </div>

      {mode === "choice" ? (
        <p className="notice">Choose a path to bind one trusted repository and create the first stages.</p>
      ) : (
        <form className="setup-form" onSubmit={submit} aria-busy={busy}>
          <label className="field">
            <span>Trusted repository path</span>
            <input
              required
              value={repositoryPath}
              onChange={(event) => onRepositoryPathChange(event.currentTarget.value)}
              placeholder="/Users/name/projects/repository"
              disabled={busy}
            />
            <small>One board binds to one local repository.</small>
          </label>

          {mode === "starter" ? (
            <fieldset>
              <legend>Editable starter stages</legend>
              <p>Stages are created unconfigured. Assign each stage a validated Workflow Skill before running work.</p>
              <ol className="starter-stages">
                {starterLabels.map((label, index) => (
                  <li key={index}>
                    <label>
                      <span className="sr-only">Stage {index + 1}</span>
                      <input
                        required
                        value={label}
                        onChange={(event) => onStarterLabelChange(index, event.currentTarget.value)}
                        disabled={busy}
                      />
                    </label>
                  </li>
                ))}
              </ol>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Creating starter workflow…" : "Create starter workflow"}
              </button>
            </fieldset>
          ) : (
            <div>
              <p>The board opens with no stages. Stage setup opens immediately after the repository is bound.</p>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Creating blank board…" : "Create blank board"}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
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
        <div>
          <p className="eyebrow">Trusted repository</p>
          <h2 id="workflow-canvas-title">Workflow canvas</h2>
          <p className="repository-path">{board.repositoryPath}</p>
        </div>
        <div className="canvas-actions">
          {!isCommittedOrderedPath(board, stages, projection.edges) && stages.length >= 2 ? (
            <button type="button" className="button button-secondary" onClick={onConnect} disabled={busy}>
              Connect ordered path
            </button>
          ) : (
            <span className="path-status">Ordered path connected</span>
          )}
        </div>
      </header>

      <p className="canvas-help">
        Drag a stage column to reorder it, or use Move earlier and Move later. Only committed immediate-successor arrows are shown.
      </p>

      <ol className="stage-list" aria-label="Ordered Workflow Stages">
        {stages.map((stage, index) => {
          const configurationReason = stageConfigurationReason(stage, catalog);
          const nextArrow = arrows.find(({ sourceStageId }) => sourceStageId === stage.stageId);
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
                <div>
                  <p className="stage-position">Stage {index + 1}</p>
                  <h3>{stage.label}</h3>
                </div>
                <div className="reorder-controls" aria-label={`Reorder ${stage.label}`}>
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={busy || index === 0}
                    onClick={() => {
                      const intent = keyboardStageReorderIntent(board, stages, stage.stageId, "previous");
                      if (intent !== null) onReorder(intent);
                    }}
                  >
                    Move earlier
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={busy || index === stages.length - 1}
                    onClick={() => {
                      const intent = keyboardStageReorderIntent(board, stages, stage.stageId, "next");
                      if (intent !== null) onReorder(intent);
                    }}
                  >
                    Move later
                  </button>
                </div>
              </header>

              {configurationReason === null ? (
                <p className="stage-configured">Configured Workflow Skill</p>
              ) : (
                <div className="notice notice-warning">
                  <strong>Stage not runnable:</strong> {configurationReason}
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => onConfigureStage(stage)}
                    disabled={busy}
                  >
                    Configure stage Skill
                  </button>
                </div>
              )}

              <ul className="card-list" aria-label={`${stage.label} cards`}>
                {(cardsByStage.get(stage.stageId) ?? []).map((card) => {
                  const movement = cardMovementAffordance(projection, card);
                  const selected = selectedCardId === card.cardId;
                  return (
                    <li key={card.cardId}>
                      <article
                        id={`card-${card.cardId}`}
                        tabIndex={-1}
                        className={`workflow-card${selected ? " is-selected" : ""}${card.executionStatus === "needs_attention" ? " needs-attention" : ""}`}
                        aria-label={`${card.title}, ${statusLabel(card.executionStatus)}`}
                      >
                        {card.executionStatus === "needs_attention" ? (
                          <p className="attention-label"><strong>Attention required</strong></p>
                        ) : null}
                        <button
                          type="button"
                          className="card-title-button"
                          aria-pressed={selected}
                          onClick={() => onSelectCard(card)}
                        >
                          Open {card.title} inspector
                        </button>
                        <dl className="card-facts">
                          <div><dt>Workflow Stage</dt><dd>{stage.label}</dd></div>
                          <div><dt>Execution Status</dt><dd>{statusLabel(card.executionStatus)}</dd></div>
                        </dl>
                        {!card.runnable ? <p><strong>Not runnable:</strong> Card configuration is disabled.</p> : null}
                        {!movement.allowed ? <p className="stage-lock">{movement.reason}</p> : null}
                        {movement.targetStageId !== null ? (
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busy || !movement.allowed}
                            aria-describedby={`movement-${card.cardId}`}
                            onClick={() => onMoveCard(card, movement.targetStageId!)}
                          >
                            Move to next stage
                          </button>
                        ) : null}
                        <span id={`movement-${card.cardId}`} className="sr-only">{movement.reason}</span>
                      </article>
                    </li>
                  );
                })}
              </ul>

              {nextArrow !== undefined ? (
                <p className="stage-arrow" aria-label={`Next stage: ${stages[index + 1]!.label}`}>
                  <span aria-hidden="true">→</span> {stages[index + 1]!.label}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
