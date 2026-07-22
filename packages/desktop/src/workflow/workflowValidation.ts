import type { EdgeProjection, StageId, StageProjection } from "./workflowTypes.ts";

export type WorkflowValidationErrorKind =
  | "no_stages"
  | "unknown_stage"
  | "self_edge"
  | "duplicate_edge"
  | "branch"
  | "join"
  | "disconnected"
  | "cycle";

export interface WorkflowValidationError {
  readonly kind: WorkflowValidationErrorKind;
  readonly message: string;
  readonly stageId?: StageId;
}

export type LinearWorkflowValidation =
  | { readonly valid: true; readonly orderedStageIds: readonly StageId[] }
  | { readonly valid: false; readonly error: WorkflowValidationError };

function invalid(
  kind: WorkflowValidationErrorKind,
  message: string,
  stageId?: StageId,
): LinearWorkflowValidation {
  return { valid: false, error: { kind, message, ...(stageId === undefined ? {} : { stageId }) } };
}

export function sortStagesByPosition(stages: readonly StageProjection[]): readonly StageProjection[] {
  return [...stages].sort((left, right) => (
    left.position - right.position || left.stageId.localeCompare(right.stageId)
  ));
}

export function validateLinearWorkflow(
  stages: readonly StageProjection[],
  edges: readonly Pick<EdgeProjection, "sourceStageId" | "targetStageId">[],
): LinearWorkflowValidation {
  if (stages.length === 0) return invalid("no_stages", "A workflow requires at least one stage");

  const stageIds = new Set(stages.map(({ stageId }) => stageId));
  const inbound = new Map<StageId, number>();
  const outbound = new Map<StageId, StageId>();
  const edgeKeys = new Set<string>();

  for (const edge of edges) {
    if (!stageIds.has(edge.sourceStageId)) {
      return invalid("unknown_stage", `Unknown source stage ${edge.sourceStageId}`, edge.sourceStageId);
    }
    if (!stageIds.has(edge.targetStageId)) {
      return invalid("unknown_stage", `Unknown target stage ${edge.targetStageId}`, edge.targetStageId);
    }
    if (edge.sourceStageId === edge.targetStageId) {
      return invalid("self_edge", `Stage ${edge.sourceStageId} cannot point to itself`, edge.sourceStageId);
    }

    const edgeKey = `${edge.sourceStageId}\u0000${edge.targetStageId}`;
    if (edgeKeys.has(edgeKey)) {
      return invalid("duplicate_edge", "The workflow contains a duplicate edge", edge.sourceStageId);
    }
    edgeKeys.add(edgeKey);

    if (outbound.has(edge.sourceStageId)) {
      return invalid("branch", `Stage ${edge.sourceStageId} has more than one successor`, edge.sourceStageId);
    }
    outbound.set(edge.sourceStageId, edge.targetStageId);
    const nextInbound = (inbound.get(edge.targetStageId) ?? 0) + 1;
    if (nextInbound > 1) {
      return invalid("join", `Stage ${edge.targetStageId} has more than one predecessor`, edge.targetStageId);
    }
    inbound.set(edge.targetStageId, nextInbound);
  }

  const starts = stages.filter(({ stageId }) => !inbound.has(stageId));
  const ends = stages.filter(({ stageId }) => !outbound.has(stageId));
  if (starts.length === 0 || ends.length === 0) {
    return invalid("cycle", "The workflow contains a cycle");
  }
  if (starts.length !== 1 || ends.length !== 1) {
    return invalid("disconnected", "The workflow must contain exactly one connected path");
  }

  const orderedStageIds: StageId[] = [];
  const visited = new Set<StageId>();
  let current: StageId | undefined = starts[0]?.stageId;
  while (current !== undefined) {
    if (visited.has(current)) return invalid("cycle", "The workflow contains a cycle", current);
    visited.add(current);
    orderedStageIds.push(current);
    current = outbound.get(current);
  }

  if (visited.size !== stages.length || edges.length !== Math.max(0, stages.length - 1)) {
    return invalid("disconnected", "The workflow must contain exactly one connected path");
  }
  return { valid: true, orderedStageIds };
}

export function validateConfigurableWorkflowPath(
  stages: readonly StageProjection[],
  edges: readonly Pick<EdgeProjection, "sourceStageId" | "targetStageId">[],
): LinearWorkflowValidation {
  if (stages.length === 0) return invalid("no_stages", "A workflow requires at least one stage");

  const ordered = sortStagesByPosition(stages);
  const stageIds = new Set(ordered.map(({ stageId }) => stageId));
  const edgeKeys = new Set<string>();
  const inbound = new Set<StageId>();
  const outbound = new Map<StageId, StageId>();
  for (const edge of edges) {
    if (!stageIds.has(edge.sourceStageId)) {
      return invalid("unknown_stage", `Unknown source stage ${edge.sourceStageId}`, edge.sourceStageId);
    }
    if (!stageIds.has(edge.targetStageId)) {
      return invalid("unknown_stage", `Unknown target stage ${edge.targetStageId}`, edge.targetStageId);
    }
    if (edge.sourceStageId === edge.targetStageId) {
      return invalid("self_edge", `Stage ${edge.sourceStageId} cannot point to itself`, edge.sourceStageId);
    }
    const edgeKey = `${edge.sourceStageId}\u0000${edge.targetStageId}`;
    if (edgeKeys.has(edgeKey)) {
      return invalid("duplicate_edge", "The workflow contains a duplicate edge", edge.sourceStageId);
    }
    edgeKeys.add(edgeKey);
    if (outbound.has(edge.sourceStageId)) {
      return invalid("branch", `Stage ${edge.sourceStageId} has more than one successor`, edge.sourceStageId);
    }
    if (inbound.has(edge.targetStageId)) {
      return invalid("join", `Stage ${edge.targetStageId} has more than one predecessor`, edge.targetStageId);
    }
    outbound.set(edge.sourceStageId, edge.targetStageId);
    inbound.add(edge.targetStageId);
  }

  for (const stage of ordered) {
    const visited = new Set<StageId>();
    let current: StageId | undefined = stage.stageId;
    while (current !== undefined) {
      if (visited.has(current)) return invalid("cycle", "The workflow contains a cycle", current);
      visited.add(current);
      current = outbound.get(current);
    }
  }

  return { valid: true, orderedStageIds: ordered.map(({ stageId }) => stageId) };
}

export function immediateSuccessor(
  stageId: StageId,
  edges: readonly Pick<EdgeProjection, "sourceStageId" | "targetStageId">[],
): StageId | null {
  return edges.find((edge) => edge.sourceStageId === stageId)?.targetStageId ?? null;
}
