import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal } from "@heroui/react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import type { WorkflowBoardProjection } from "../../../shared/rpc.ts";
import type { StageId, StageProjection } from "../../../workflow/workflowTypes.ts";
import { validateConfigurableWorkflowPath, validateLinearWorkflow } from "../../../workflow/workflowValidation.ts";
import { CheckIcon, PathIcon, TrashIcon, XIcon } from "../../components/Icons.tsx";
import type { StagePathEdge } from "./boardInteractions.ts";

interface PathEditorModalProps {
  readonly projection: WorkflowBoardProjection;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (edges: readonly StagePathEdge[]) => void;
}

const NODE_WIDTH = 176;
const NODE_HEIGHT = 112;
const NODE_GAP = 96;
const CANVAS_PADDING = 48;
const CANVAS_HEIGHT = 384;
const DEFAULT_NODE_TOP = 136;
const NODE_Y_PADDING = 48;

export interface StageNodePosition {
  readonly x: number;
  readonly y: number;
}

type StageNodePositions = Readonly<Record<string, StageNodePosition>>;

interface DragPosition {
  readonly stageId: StageId;
  readonly x: number;
  readonly y: number;
}

function edgeKey(edge: StagePathEdge): string {
  return `${edge.sourceStageId}\u0000${edge.targetStageId}`;
}

function sameEdges(left: readonly StagePathEdge[], right: readonly StagePathEdge[]): boolean {
  const leftKeys = new Set(left.map(edgeKey));
  return leftKeys.size === right.length && right.every((edge) => leftKeys.has(edgeKey(edge)));
}

function initialNodePositions(stages: readonly StageProjection[]): StageNodePositions {
  return Object.fromEntries(stages.map((stage, index) => [
    stage.stageId,
    { x: CANVAS_PADDING + index * (NODE_WIDTH + NODE_GAP), y: DEFAULT_NODE_TOP },
  ]));
}

export function constrainStagePosition(
  origin: StageNodePosition,
  delta: { readonly x: number; readonly y: number },
  canvasWidth: number,
): StageNodePosition {
  return {
    x: Math.min(canvasWidth - CANVAS_PADDING - NODE_WIDTH, Math.max(CANVAS_PADDING, origin.x + delta.x)),
    y: Math.min(CANVAS_HEIGHT - NODE_Y_PADDING - NODE_HEIGHT, Math.max(NODE_Y_PADDING, origin.y + delta.y)),
  };
}

function stagePoint(
  stages: readonly StageProjection[],
  stageId: StageId,
  side: "input" | "output",
  positions: StageNodePositions = initialNodePositions(stages),
) {
  const index = stages.findIndex((stage) => stage.stageId === stageId);
  const position = positions[stageId] ?? {
    x: CANVAS_PADDING + index * (NODE_WIDTH + NODE_GAP),
    y: DEFAULT_NODE_TOP,
  };
  return {
    x: position.x + (side === "output" ? NODE_WIDTH : 0),
    y: position.y + NODE_HEIGHT / 2,
  };
}

export function workflowConnectionPath(
  stages: readonly StageProjection[],
  sourceStageId: StageId,
  targetStageId: StageId,
  positions: StageNodePositions = initialNodePositions(stages),
): string {
  const source = stagePoint(stages, sourceStageId, "output", positions);
  const target = stagePoint(stages, targetStageId, "input", positions);
  const sourceIndex = stages.findIndex((stage) => stage.stageId === sourceStageId);
  const targetIndex = stages.findIndex((stage) => stage.stageId === targetStageId);
  if (targetIndex === sourceIndex + 1) {
    const bend = Math.max(40, (target.x - source.x) * 0.42);
    return `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - bend} ${target.y}, ${target.x} ${target.y}`;
  }

  const forward = targetIndex > sourceIndex;
  const span = Math.abs(targetIndex - sourceIndex);
  const laneOffset = Math.min(Math.max(0, span - 2), 4) * 8;
  const occupied = Object.values(positions);
  const topRailY = Math.max(20, Math.min(...occupied.map(({ y }) => y)) - 64);
  const bottomRailY = Math.min(CANVAS_HEIGHT - 20, Math.max(...occupied.map(({ y }) => y + NODE_HEIGHT)) + 64);
  const railY = forward ? topRailY + laneOffset : bottomRailY - laneOffset;
  const sourceTurnX = source.x + 44;
  const targetTurnX = target.x - 44;
  return `M ${source.x} ${source.y} C ${sourceTurnX} ${source.y}, ${sourceTurnX} ${railY}, ${sourceTurnX} ${railY} L ${targetTurnX} ${railY} C ${targetTurnX} ${railY}, ${targetTurnX} ${target.y}, ${target.x} ${target.y}`;
}

interface DraggableStageNodeProps {
  readonly stage: StageProjection;
  readonly index: number;
  readonly position: StageNodePosition;
  readonly isSource: boolean;
  readonly hasIncoming: boolean;
  readonly hasOutgoing: boolean;
  readonly busy: boolean;
  readonly onBeginConnection: (stageId: StageId) => void;
  readonly onConnectTo: (stageId: StageId) => void;
  readonly onBeginPointerConnection: (stageId: StageId, event: ReactPointerEvent<HTMLButtonElement>) => void;
}

function DraggableStageNode({
  stage,
  index,
  position,
  isSource,
  hasIncoming,
  hasOutgoing,
  busy,
  onBeginConnection,
  onConnectTo,
  onBeginPointerConnection,
}: DraggableStageNodeProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: stage.stageId,
    disabled: busy,
  });
  const style: CSSProperties = { left: position.x, top: position.y };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging}
      className={`absolute flex h-28 w-44 shrink-0 flex-col justify-between rounded-xl border bg-[var(--surface)] p-4 shadow-sm data-[dragging=true]:opacity-70 data-[dragging=true]:ring-2 data-[dragging=true]:ring-[var(--accent)] ${isSource ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]" : "border-[var(--border)]"}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="absolute inset-0 cursor-grab touch-none rounded-[inherit] bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:cursor-grabbing disabled:cursor-not-allowed"
        aria-label={`Move ${stage.label} on canvas`}
        disabled={busy}
        {...attributes}
        {...listeners}
      >
        <span className="sr-only">Move {stage.label} on canvas</span>
      </button>
      <button
        type="button"
        data-stage-input={stage.stageId}
        className={`absolute -left-5 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border-2 bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${hasIncoming ? "border-[var(--accent)]" : "border-[var(--border)]"}`}
        aria-label={`Connect to ${stage.label}`}
        onPointerUp={() => onConnectTo(stage.stageId)}
        onClick={() => onConnectTo(stage.stageId)}
        disabled={busy}
      >
        <span className="size-2 rounded-full bg-current" />
      </button>
      <div className="pointer-events-none relative">
        <span className="block text-xs font-medium uppercase tracking-wide text-muted">Stage {index + 1}</span>
        <span className="mt-1 block truncate font-semibold text-foreground" title={stage.label}>{stage.label}</span>
      </div>
      <span className="pointer-events-none relative text-xs text-muted">{hasIncoming ? "Input connected" : "Input open"} · {hasOutgoing ? "Output connected" : "Output open"}</span>
      <button
        type="button"
        className={`absolute -right-5 top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border-2 bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${isSource || hasOutgoing ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)]"}`}
        aria-label={`Start connection from ${stage.label}`}
        aria-pressed={isSource}
        onPointerDown={(event) => onBeginPointerConnection(stage.stageId, event)}
        onClick={() => onBeginConnection(stage.stageId)}
        disabled={busy}
      >
        <span className="size-2 rounded-full bg-current" />
      </button>
    </li>
  );
}

export function PathEditorModal({ projection, busy, onClose, onSave }: PathEditorModalProps) {
  const stages = useMemo(
    () => [...projection.stages].sort((left, right) => left.position - right.position),
    [projection.stages],
  );
  const committedEdges = useMemo<readonly StagePathEdge[]>(
    () => projection.edges.map(({ sourceStageId, targetStageId }) => ({ sourceStageId, targetStageId })),
    [projection.edges],
  );
  const [edges, setEdges] = useState<readonly StagePathEdge[]>(committedEdges);
  const [sourceStageId, setSourceStageId] = useState<StageId | null>(null);
  const [pointer, setPointer] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [nodePositions, setNodePositions] = useState<StageNodePositions>(() => initialNodePositions(stages));
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const [announcement, setAnnouncement] = useState("Drag from an output handle to an input handle, or activate both handles with the keyboard.");
  const canvasRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const complete = validateLinearWorkflow(stages, edges).valid;
  const changed = !sameEdges(edges, committedEdges);
  const expectedConnections = Math.max(0, stages.length - 1);
  const canvasWidth = Math.max(640, CANVAS_PADDING * 2 + stages.length * NODE_WIDTH + Math.max(0, stages.length - 1) * NODE_GAP);
  const displayedPositions = useMemo<StageNodePositions>(() => {
    if (dragPosition === null) return nodePositions;
    return { ...nodePositions, [dragPosition.stageId]: { x: dragPosition.x, y: dragPosition.y } };
  }, [dragPosition, nodePositions]);

  function label(stageId: StageId): string {
    return stages.find((stage) => stage.stageId === stageId)?.label ?? "Unknown stage";
  }

  function beginConnection(stageId: StageId) {
    if (busy) return;
    setSourceStageId(stageId);
    setAnnouncement(`${label(stageId)} selected as the source. Choose a target stage.`);
  }

  function connectTo(targetStageId: StageId) {
    if (sourceStageId === null) {
      setAnnouncement("Choose a stage output before choosing a target.");
      return;
    }
    if (sourceStageId === targetStageId) {
      setAnnouncement("A stage cannot connect to itself.");
      setPointer(null);
      return;
    }
    const candidate = [
      ...edges.filter((edge) => edge.sourceStageId !== sourceStageId && edge.targetStageId !== targetStageId),
      { sourceStageId, targetStageId },
    ];
    const validation = validateConfigurableWorkflowPath(stages, candidate);
    if (!validation.valid) {
      setAnnouncement(validation.error.message);
      setPointer(null);
      return;
    }
    setEdges(candidate);
    setAnnouncement(`Connected ${label(sourceStageId)} to ${label(targetStageId)}.`);
    setSourceStageId(null);
    setPointer(null);
  }

  function trackPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (sourceStageId === null || canvasRef.current === null) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    setPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  }

  function moveStage(event: DragMoveEvent) {
    const stageId = event.active.id as StageId;
    const origin = nodePositions[stageId];
    if (origin === undefined) return;
    setDragPosition({ stageId, ...constrainStagePosition(origin, event.delta, canvasWidth) });
  }

  function finishStageMove(event: DragEndEvent) {
    const stageId = event.active.id as StageId;
    const origin = nodePositions[stageId];
    if (origin === undefined) return;
    const position = constrainStagePosition(origin, event.delta, canvasWidth);
    setNodePositions((current) => ({ ...current, [stageId]: position }));
    setAnnouncement(`Moved ${label(stageId)} on the canvas.`);
    setDragPosition(null);
  }

  return (
    <Modal.Backdrop isOpen onOpenChange={(open) => !open && !busy && onClose()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog className="max-h-[min(52rem,calc(100vh-2rem))] max-w-[72rem]">
          <Modal.CloseTrigger isDisabled={busy} />
          <Modal.Header>
            <div className="flex items-start gap-3">
              <span className="mt-1 grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]">
                <PathIcon />
              </span>
              <div>
                <Modal.Heading>Edit workflow path</Modal.Heading>
                <p className="mt-1 max-w-2xl text-sm text-muted">
                  Drag from a stage output to another stage input. Each stage can have one incoming and one outgoing connection.
                </p>
              </div>
            </div>
          </Modal.Header>
          <Modal.Body className="gap-5">
            {stages.length < 2 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-5 text-sm text-muted">
                Add at least two stages before configuring a workflow path.
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] px-4 py-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className={`grid size-8 place-items-center rounded-full ${complete ? "bg-[var(--success-soft)] text-[var(--success-soft-foreground)]" : "bg-[var(--warning-soft)] text-[var(--warning-soft-foreground)]"}`}>
                      {complete ? <CheckIcon /> : <XIcon />}
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">{complete ? "Path ready" : "Path incomplete"}</p>
                      <p className="text-muted">{edges.length} of {expectedConnections} connections</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setEdges([]);
                      setSourceStageId(null);
                      setPointer(null);
                      setAnnouncement("All path connections removed.");
                    }}
                    isDisabled={busy || edges.length === 0}
                  >
                    <TrashIcon />Clear path
                  </Button>
                </div>

                <DndContext
                  sensors={sensors}
                  onDragMove={moveStage}
                  onDragEnd={finishStageMove}
                  onDragCancel={() => setDragPosition(null)}
                >
                  <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]">
                    <div
                      ref={canvasRef}
                      className="relative h-96 select-none"
                      style={{ width: canvasWidth }}
                      aria-label="Workflow path canvas"
                      onPointerMove={trackPointer}
                      onPointerLeave={() => setPointer(null)}
                    >
                    <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                      <defs>
                        <marker id="workflow-path-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                          <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent)" />
                        </marker>
                      </defs>
                      {edges.map((edge) => (
                        <path
                          key={edgeKey(edge)}
                          data-source-stage={edge.sourceStageId}
                          data-target-stage={edge.targetStageId}
                          d={workflowConnectionPath(stages, edge.sourceStageId, edge.targetStageId, displayedPositions)}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          markerEnd="url(#workflow-path-arrow)"
                        />
                      ))}
                      {sourceStageId !== null && pointer !== null ? (
                        <path
                          d={`M ${stagePoint(stages, sourceStageId, "output", displayedPositions).x} ${stagePoint(stages, sourceStageId, "output", displayedPositions).y} C ${stagePoint(stages, sourceStageId, "output", displayedPositions).x + 56} ${stagePoint(stages, sourceStageId, "output", displayedPositions).y}, ${pointer.x - 56} ${pointer.y}, ${pointer.x} ${pointer.y}`}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="3"
                          strokeDasharray="6 5"
                        />
                      ) : null}
                    </svg>

                    <ol className="absolute inset-0 m-0 list-none p-0" aria-label="Workflow stages">
                      {stages.map((stage, index) => {
                        const isSource = sourceStageId === stage.stageId;
                        const hasIncoming = edges.some((edge) => edge.targetStageId === stage.stageId);
                        const hasOutgoing = edges.some((edge) => edge.sourceStageId === stage.stageId);
                        return (
                          <DraggableStageNode
                            key={stage.stageId}
                            stage={stage}
                            index={index}
                            position={displayedPositions[stage.stageId]!}
                            isSource={isSource}
                            hasIncoming={hasIncoming}
                            hasOutgoing={hasOutgoing}
                            busy={busy}
                            onBeginConnection={beginConnection}
                            onConnectTo={connectTo}
                            onBeginPointerConnection={(stageId, event) => {
                              beginConnection(stageId);
                              const bounds = canvasRef.current?.getBoundingClientRect();
                              if (bounds !== undefined) setPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
                            }}
                          />
                        );
                      })}
                    </ol>
                  </div>
                  </div>
                </DndContext>

                <div className="mt-4 grid gap-2" aria-label="Current path connections">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Connections</h3>
                    <span className="text-xs text-muted">Drag handles or use Enter/Space</span>
                  </div>
                  {edges.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-sm text-muted">No stages are connected yet.</p>
                  ) : edges.map((edge) => (
                    <div key={edgeKey(edge)} className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-2">
                      <span className="min-w-0 truncate text-sm text-foreground">
                        <strong>{label(edge.sourceStageId)}</strong><span className="px-2 text-muted">→</span><strong>{label(edge.targetStageId)}</strong>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          setEdges((current) => current.filter((candidate) => edgeKey(candidate) !== edgeKey(edge)));
                          setAnnouncement(`Removed the connection from ${label(edge.sourceStageId)} to ${label(edge.targetStageId)}.`);
                        }}
                        isDisabled={busy}
                        aria-label={`Remove connection from ${label(edge.sourceStageId)} to ${label(edge.targetStageId)}`}
                      >
                        <TrashIcon />Remove
                      </Button>
                    </div>
                  ))}
                </div>

                {!complete ? (
                  <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning-soft-foreground)]">
                    You can save an incomplete path, but tasks cannot run until every stage forms one continuous path.
                  </p>
                ) : null}
                <p className="sr-only" aria-live="polite">{announcement}</p>
              </>
            )}
          </Modal.Body>
          <Modal.Footer className="gap-3 border-t border-[var(--border)] pt-4">
            <Button variant="secondary" onPress={onClose} isDisabled={busy}>Cancel</Button>
            <Button onPress={() => onSave(edges)} isDisabled={busy || stages.length < 2 || !changed}>Save path</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
