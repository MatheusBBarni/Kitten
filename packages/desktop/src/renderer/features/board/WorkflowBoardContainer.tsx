import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopRpcClient } from "../../client.ts";
import { bindWorkflowBoardRenderer } from "../../client.ts";
import type {
  WorkflowBoardProjection,
  WorkflowCatalogProjection,
} from "../../../shared/rpc.ts";
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
  type BoardInteractionResult,
  type IdentityFactory,
} from "./boardInteractions.ts";
import { BlankBoardSetup, BoardCanvas, type SetupMode } from "./WorkflowBoard.tsx";
import { StageSetupModal } from "./StageSetupModal.tsx";
import { CardInspector } from "../inspector/CardInspector.tsx";

interface Feedback {
  readonly message: string;
  readonly tone: "status" | "error";
}

export function WorkflowBoard({ client }: { readonly client: DesktopRpcClient }) {
  const identities = useRef<IdentityFactory>(createBrowserIdentityFactory());
  const [projection, setProjection] = useState<WorkflowBoardProjection | null>(null);
  const [catalog, setCatalog] = useState<WorkflowCatalogProjection | null>(null);
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

  useEffect(() => {
    const binding = bindWorkflowBoardRenderer(client, {
      onBoard(envelope) {
        if (envelope.result.status === "ok") {
          setProjection(envelope.result.projection);
          setLoadError(null);
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
    });
    return () => binding.dispose();
  }, [client]);

  const applyResult = useCallback((result: BoardInteractionResult): boolean => {
    const message = boardInteractionMessage(result);
    setFeedback({
      message: message ?? "Board projection committed.",
      tone: result.status === "ok" ? "status" : "error",
    });
    if (result.status !== "ok") return false;
    setProjection(result.projection);
    return true;
  }, []);

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

  function focusCard(cardId: CardId) {
    document.getElementById(`card-${cardId}`)?.focus();
  }

  if (loadError !== null) return <main role="alert" className="app-shell">{loadError}</main>;
  if (projection === null || catalog === null) {
    return <main aria-busy="true" className="app-shell">Loading Workflow Board…</main>;
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
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Local-first orchestration</p>
          <h1>Kitten Orchestrator</h1>
        </div>
        <p className="revision">Projection revision {projection.revision}</p>
      </header>

      {feedback !== null ? (
        <p
          className={feedback.tone === "status" ? "notice" : "notice notice-error"}
          role={feedback.tone === "status" ? "status" : "alert"}
        >
          {feedback.message}
        </p>
      ) : null}

      {projection.board === null ? (
        <BlankBoardSetup
          mode={setupMode}
          repositoryPath={repositoryPath}
          starterLabels={starterLabels}
          busy={busy}
          onModeChange={setSetupMode}
          onRepositoryPathChange={setRepositoryPath}
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
          <nav className="board-shortcuts" aria-label="Board card shortcuts">
            {selectedCard !== null ? (
              <button type="button" className="button button-secondary" onClick={() => focusCard(selectedCard.cardId)}>
                Jump to selected card
              </button>
            ) : null}
            {attentionCard !== null ? (
              <button type="button" className="button button-attention" onClick={() => focusCard(attentionCard.cardId)}>
                Jump to attention card: {attentionCard.title}
              </button>
            ) : null}
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setStageDialogMode("create");
                setStageBeingConfigured(null);
                setStageLabel("");
                setStageSkillId(null);
              }}
              disabled={busy}
            >
              Add Workflow Stage
            </button>
          </nav>

          <div className={selectedCard === null ? "board-workspace" : "board-workspace has-inspector"}>
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
                setFeedback({ message: `Inspector selected for ${card.title}.`, tone: "status" });
              }}
            />
            {selectedCard !== null ? (
              <CardInspector key={selectedCard.cardId} client={client} card={selectedCard} />
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
  );
}
