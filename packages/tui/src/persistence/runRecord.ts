import { z } from "zod"

import { restoreManifest } from "../core/contextPack.ts"
import type { ResolvedSession } from "../core/types.ts"

const SESSION_STATUS_SCHEMA = z.enum([
  "idle",
  "working",
  "awaiting_clarification",
  "awaiting_approval",
  "finished",
  "error",
])
const PROVIDER_KIND_SCHEMA = z.enum(["claude-code", "codex", "cursor"])
const NONNEGATIVE_INTEGER_SCHEMA = z.number().int().nonnegative()
const SHA256_DIGEST_SCHEMA = z.string().regex(/^[a-f0-9]{64}$/)

const HANDOFF_FILE_SCHEMA = z.strictObject({
  path: z.string(),
  reason: z.enum(["read", "edited"]),
})

const PENDING_DIFF_SCHEMA = z.strictObject({
  toolCallId: z.string(),
  path: z.string(),
  unified: z.string(),
})

const SHELL_COMMAND_SCHEMA = z.strictObject({
  id: z.string(),
  command: z.string(),
  output: z.string(),
  exitCode: z.number().finite().nullable(),
})

const HANDOFF_CONTEXT_PACK_SCHEMA = z.strictObject({
  payload: z.string(),
  bytes: NONNEGATIVE_INTEGER_SCHEMA,
  sealedAt: z.number().finite().nonnegative(),
  revision: NONNEGATIVE_INTEGER_SCHEMA,
  sourceIdentities: z.array(z.string()).readonly(),
  redactionCount: NONNEGATIVE_INTEGER_SCHEMA.optional(),
}).superRefine((sealed, context) => {
  if (new TextEncoder().encode(sealed.payload).byteLength !== sealed.bytes) {
    context.addIssue({
      code: "custom",
      message: "Handoff Context Pack byte count does not match the exact payload",
      path: ["bytes"],
    })
  }
})

const HANDOFF_BUNDLE_SCHEMA = z.strictObject({
  intent: z.literal("continue"),
  summary: z.string(),
  files: z.array(HANDOFF_FILE_SCHEMA),
  pendingDiffs: z.array(PENDING_DIFF_SCHEMA),
  shell: z
    .strictObject({
      cwd: z.string(),
      commands: z.array(SHELL_COMMAND_SCHEMA),
    })
    .optional(),
  contextPack: HANDOFF_CONTEXT_PACK_SCHEMA.optional(),
  redactionCount: z.number().finite(),
})

export const PERSISTED_AGENT_V1_SCHEMA = z.object({
  sessionId: z.string(),
  lastPrompt: z.string(),
  messageCount: z.number().finite(),
  status: SESSION_STATUS_SCHEMA,
})

/** Legacy V1 shape. Unknown keys are stripped to retain its tolerant load behavior. */
export const PERSISTED_RUN_RECORD_V1_SCHEMA = z.object({
  version: z.literal(1),
  runId: z.string(),
  cwd: z.string(),
  gitBranch: z.string().nullable(),
  focusedAgentId: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  agents: z.record(z.string(), PERSISTED_AGENT_V1_SCHEMA),
  handoffBundle: HANDOFF_BUNDLE_SCHEMA.nullable(),
})

export const PERSISTED_CONVERSATION_V2_SCHEMA = z.strictObject({
  sessionId: z.string(),
  providerKind: PROVIDER_KIND_SCHEMA,
  cwd: z.string(),
  initialTitle: z.string(),
  acpSessionId: z.string(),
  lastPrompt: z.string(),
  messageCount: z.number().finite(),
  status: SESSION_STATUS_SCHEMA,
})

export const PERSISTED_WORKSPACE_CONVERSATION_V2_SCHEMA = z.strictObject({
  sessionId: z.string(),
  displayName: z.string(),
  lifecycle: z.enum(["visible", "background"]),
  createdOrdinal: z.number().int().nonnegative(),
  attention: z.strictObject({
    seen: z.boolean(),
    sequence: z.number().int().nonnegative(),
  }),
})

export const PERSISTED_WORKSPACE_V2_SCHEMA = z.strictObject({
  conversations: z.record(z.string(), PERSISTED_WORKSPACE_CONVERSATION_V2_SCHEMA),
  order: z.array(z.string()),
  selectedVisibleId: z.string().nullable(),
})

export const PERSISTED_RUN_RECORD_V2_SCHEMA = z.strictObject({
  version: z.literal(2),
  runId: z.string(),
  cwd: z.string(),
  gitBranch: z.string().nullable(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  conversations: z.record(z.string(), PERSISTED_CONVERSATION_V2_SCHEMA),
  workspace: PERSISTED_WORKSPACE_V2_SCHEMA,
  handoffBundle: HANDOFF_BUNDLE_SCHEMA.nullable(),
})

export const HARNESS_DELIVERY_CHECKPOINT_SCHEMA = z.discriminatedUnion("state", [
  z.strictObject({
    version: z.literal("v1"),
    generation: z.number().int().nonnegative(),
    state: z.literal("not_required"),
  }),
  z.strictObject({
    version: z.literal("v1"),
    generation: z.number().int().nonnegative(),
    state: z.literal("pending"),
  }),
  z.strictObject({
    version: z.literal("v1"),
    generation: z.number().int().nonnegative(),
    state: z.literal("in_flight"),
  }),
  z.strictObject({
    version: z.literal("v1"),
    generation: z.number().int().nonnegative(),
    state: z.literal("delivered"),
  }),
  z.strictObject({
    version: z.literal("v1"),
    generation: z.number().int().nonnegative(),
    state: z.literal("settled_interrupted"),
  }),
  z.strictObject({
    version: z.literal("v1"),
    generation: z.number().int().nonnegative(),
    state: z.literal("failed"),
    failureCategory: z.enum([
      "unsupported_profile",
      "harness_render_failed",
      "dispatch_indeterminate",
    ]),
  }),
])

export const PERSISTED_RUN_RECORD_V3_SCHEMA = PERSISTED_RUN_RECORD_V2_SCHEMA.extend({
  version: z.literal(3),
  harnessDeliveries: z.record(z.string(), HARNESS_DELIVERY_CHECKPOINT_SCHEMA),
})

const PERSISTED_CONTEXT_PACK_INSTRUCTIONS_SCHEMA = z.strictObject({
  original: z.string(),
  mode: z.enum(["preserve", "augment", "rewrite"]),
  discovered: z.string(),
})

const PERSISTED_CONTEXT_PACK_BUDGET_SCHEMA = z.strictObject({
  unit: z.literal("estimated_tokens"),
  limit: z.number().int().positive(),
})

const PERSISTED_CONTEXT_PACK_BRIEF_SCHEMA = z.strictObject({
  architecture: z.string(),
  selectedContext: z.string(),
  relationships: z.string(),
  ambiguities: z.string(),
  budgetOmissions: z.string(),
})

const PERSISTED_CONTEXT_PACK_SOURCE_SCHEMA = z.strictObject({
  identity: z.string().min(1),
  digest: SHA256_DIGEST_SCHEMA,
  bytes: NONNEGATIVE_INTEGER_SCHEMA,
})

const PERSISTED_CONTEXT_PACK_SELECTION_BASE = {
  path: z.string().min(1),
  source: PERSISTED_CONTEXT_PACK_SOURCE_SCHEMA,
  rationale: z.string().min(1),
  relationship: z.string().min(1),
}

export const PERSISTED_CONTEXT_PACK_SELECTION_SCHEMA = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("full_file"),
    ...PERSISTED_CONTEXT_PACK_SELECTION_BASE,
  }),
  z.strictObject({
    kind: z.literal("file_slice"),
    ...PERSISTED_CONTEXT_PACK_SELECTION_BASE,
    range: z.strictObject({
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    }).refine((range) => range.endLine >= range.startLine, {
      message: "Slice end line must not precede its start line",
    }),
  }),
  z.strictObject({
    kind: z.literal("diff"),
    ...PERSISTED_CONTEXT_PACK_SELECTION_BASE,
    scope: z.enum(["staged", "unstaged", "pending"]),
  }),
])

export const PERSISTED_DRAFT_CONTEXT_PACK_MANIFEST_SCHEMA = z.strictObject({
  version: z.literal(1),
  revision: NONNEGATIVE_INTEGER_SCHEMA,
  instructions: PERSISTED_CONTEXT_PACK_INSTRUCTIONS_SCHEMA,
  budget: PERSISTED_CONTEXT_PACK_BUDGET_SCHEMA,
  brief: PERSISTED_CONTEXT_PACK_BRIEF_SCHEMA,
  selections: z.array(PERSISTED_CONTEXT_PACK_SELECTION_SCHEMA),
}).superRefine((manifest, context) => {
  if (restoreManifest(manifest).kind === "invalid") {
    context.addIssue({
      code: "custom",
      message: "Draft Context Pack manifest is invalid",
    })
  }
})

export const PERSISTED_SEALED_CONTEXT_PACK_SCHEMA = z.strictObject({
  payload: z.string(),
  bytes: NONNEGATIVE_INTEGER_SCHEMA,
  sealedAt: z.number().finite().nonnegative(),
  revision: NONNEGATIVE_INTEGER_SCHEMA,
}).superRefine((sealed, context) => {
  if (new TextEncoder().encode(sealed.payload).byteLength !== sealed.bytes) {
    context.addIssue({
      code: "custom",
      message: "Sealed payload byte count does not match the exact payload",
      path: ["bytes"],
    })
  }
})

export const PERSISTED_CONTEXT_PACK_SCHEMA = z.strictObject({
  draft: PERSISTED_DRAFT_CONTEXT_PACK_MANIFEST_SCHEMA.optional(),
  sealed: PERSISTED_SEALED_CONTEXT_PACK_SCHEMA.optional(),
})

export const PERSISTED_RUN_RECORD_V4_SCHEMA = PERSISTED_RUN_RECORD_V3_SCHEMA.extend({
  version: z.literal(4),
  contextPacks: z.record(z.string(), PERSISTED_CONTEXT_PACK_SCHEMA),
})

/** The complete decoded on-disk contract, including cross-collection V2-V4 invariants. */
export const PERSISTED_RUN_RECORD_SCHEMA = z
  .discriminatedUnion("version", [
    PERSISTED_RUN_RECORD_V1_SCHEMA,
    PERSISTED_RUN_RECORD_V2_SCHEMA,
    PERSISTED_RUN_RECORD_V3_SCHEMA,
    PERSISTED_RUN_RECORD_V4_SCHEMA,
  ])
  .superRefine((record, context) => {
    if (record.version === 1) return

    const orderIds = new Set<string>()
    record.workspace.order.forEach((sessionId, index) => {
      if (orderIds.has(sessionId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate workspace order id: ${sessionId}`,
          path: ["workspace", "order", index],
        })
      }
      orderIds.add(sessionId)
      if (!(sessionId in record.conversations) || !(sessionId in record.workspace.conversations)) {
        context.addIssue({
          code: "custom",
          message: `Workspace order id is missing from persisted membership: ${sessionId}`,
          path: ["workspace", "order", index],
        })
      }
    })

    for (const [sessionId, conversation] of Object.entries(record.conversations)) {
      if (conversation.sessionId !== sessionId) {
        context.addIssue({
          code: "custom",
          message: `Conversation key does not match descriptor id: ${sessionId}`,
          path: ["conversations", sessionId, "sessionId"],
        })
      }
      if (!orderIds.has(sessionId) || !(sessionId in record.workspace.conversations)) {
        context.addIssue({
          code: "custom",
          message: `Conversation is absent from workspace membership: ${sessionId}`,
          path: ["conversations", sessionId],
        })
      }
    }

    for (const [sessionId, conversation] of Object.entries(record.workspace.conversations)) {
      if (conversation.sessionId !== sessionId) {
        context.addIssue({
          code: "custom",
          message: `Workspace key does not match conversation id: ${sessionId}`,
          path: ["workspace", "conversations", sessionId, "sessionId"],
        })
      }
      if (!orderIds.has(sessionId) || !(sessionId in record.conversations)) {
        context.addIssue({
          code: "custom",
          message: `Workspace conversation is absent from execution membership: ${sessionId}`,
          path: ["workspace", "conversations", sessionId],
        })
      }
    }

    if (record.version === 3 || record.version === 4) {
      for (const sessionId of Object.keys(record.harnessDeliveries)) {
        if (!orderIds.has(sessionId) || !(sessionId in record.conversations)) {
          context.addIssue({
            code: "custom",
            message: `Harness delivery checkpoint is absent from execution membership: ${sessionId}`,
            path: ["harnessDeliveries", sessionId],
          })
        }
      }
    }

    if (record.version === 4) {
      for (const sessionId of Object.keys(record.contextPacks)) {
        if (!orderIds.has(sessionId) || !(sessionId in record.conversations)) {
          context.addIssue({
            code: "custom",
            message: `Context Pack projection is absent from execution membership: ${sessionId}`,
            path: ["contextPacks", sessionId],
          })
        }
      }
    }

    const selected = record.workspace.selectedVisibleId
    if (selected === null) {
      const visibleId = record.workspace.order.find(
        (sessionId) => record.workspace.conversations[sessionId]?.lifecycle === "visible",
      )
      if (visibleId !== undefined) {
        context.addIssue({
          code: "custom",
          message: "A workspace with visible conversations must select one of them",
          path: ["workspace", "selectedVisibleId"],
        })
      }
      if (record.gitBranch !== null) {
        context.addIssue({
          code: "custom",
          message: "A workspace without a selected visible conversation must have null branch metadata",
          path: ["gitBranch"],
        })
      }
      return
    }

    const selectedConversation = record.workspace.conversations[selected]
    if (!orderIds.has(selected) || selectedConversation?.lifecycle !== "visible") {
      context.addIssue({
        code: "custom",
        message: "Selected conversation must reference a visible workspace member",
        path: ["workspace", "selectedVisibleId"],
      })
    }
  })

export type PersistedAgent = z.infer<typeof PERSISTED_AGENT_V1_SCHEMA>
export type PersistedRunRecordV1 = z.infer<typeof PERSISTED_RUN_RECORD_V1_SCHEMA>
export type PersistedConversationV2 = z.infer<typeof PERSISTED_CONVERSATION_V2_SCHEMA>
export type PersistedWorkspaceConversationV2 = z.infer<
  typeof PERSISTED_WORKSPACE_CONVERSATION_V2_SCHEMA
>
export type PersistedWorkspaceV2 = z.infer<typeof PERSISTED_WORKSPACE_V2_SCHEMA>
export type PersistedRunRecordV2 = z.infer<typeof PERSISTED_RUN_RECORD_V2_SCHEMA>
export type HarnessDeliveryCheckpoint = z.infer<typeof HARNESS_DELIVERY_CHECKPOINT_SCHEMA>
export type PersistedRunRecordV3 = z.infer<typeof PERSISTED_RUN_RECORD_V3_SCHEMA>
export type PersistedDraftContextPackManifest = z.infer<
  typeof PERSISTED_DRAFT_CONTEXT_PACK_MANIFEST_SCHEMA
>
export type PersistedSealedContextPack = z.infer<typeof PERSISTED_SEALED_CONTEXT_PACK_SCHEMA>
export type PersistedContextPack = z.infer<typeof PERSISTED_CONTEXT_PACK_SCHEMA>
export type PersistedRunRecordV4 = z.infer<typeof PERSISTED_RUN_RECORD_V4_SCHEMA>
export type PersistedRunRecord = z.infer<typeof PERSISTED_RUN_RECORD_SCHEMA>

/** Lift an accepted V2/V3 record into the V4 envelope without inventing pack custody. */
export function migratePersistedRunToV4(
  record: PersistedRunRecordV2 | PersistedRunRecordV3 | PersistedRunRecordV4,
): PersistedRunRecordV4 {
  if (record.version === 4) return record
  const { version: _version, ...common } = record
  return {
    version: 4,
    ...common,
    harnessDeliveries: record.version === 3 ? record.harnessDeliveries : {},
    contextPacks: {},
  }
}

/** The project-picker projection of either persisted record version. */
export interface PersistedRunSummary {
  runId: string
  updatedAt: number
  gitBranch: string | null
  focusedAgentId: string | null
  lastPrompt: string
  messageCount: number
}

/** Compatibility projection used until the controller's record-driven V2 registry lands. */
export function persistedResumeAgent(
  record: PersistedRunRecord,
  sessionId: string,
): PersistedAgent | undefined {
  if (record.version === 1) return record.agents[sessionId]
  const conversation = record.conversations[sessionId]
  if (!conversation) return undefined
  return {
    sessionId: conversation.acpSessionId,
    lastPrompt: conversation.lastPrompt,
    messageCount: conversation.messageCount,
    status: conversation.status,
  }
}

export function persistedSelectedConversationId(record: PersistedRunRecord): string | null {
  return record.version === 1 ? record.focusedAgentId : record.workspace.selectedVisibleId
}

export function persistedConversationCount(record: PersistedRunRecord): number {
  return Object.keys(record.version === 1 ? record.agents : record.conversations).length
}

/**
 * Constrain a V1 record to the currently resolved configuration descriptors.
 * Legacy `PersistedAgent.sessionId` is an ACP pointer, never a dynamic Kitten id.
 */
export function migratePersistedRunV1(
  record: PersistedRunRecordV1,
  resolvedSessions: readonly ResolvedSession[],
): PersistedRunRecordV2 {
  const conversations: Record<string, PersistedConversationV2> = {}
  const workspaceConversations: Record<string, PersistedWorkspaceConversationV2> = {}
  const order: string[] = []

  for (const resolved of resolvedSessions) {
    const sessionId = resolved.seed.id
    const stored = record.agents[sessionId]
    if (!stored) continue

    order.push(sessionId)
    conversations[sessionId] = {
      sessionId,
      providerKind: resolved.seed.providerKind,
      cwd: resolved.seed.cwd,
      initialTitle: resolved.seed.title,
      acpSessionId: stored.sessionId,
      lastPrompt: stored.lastPrompt,
      messageCount: stored.messageCount,
      status: stored.status,
    }
    workspaceConversations[sessionId] = {
      sessionId,
      displayName: resolved.seed.title,
      lifecycle: "visible",
      createdOrdinal: order.length - 1,
      attention: { seen: false, sequence: 0 },
    }
  }

  const selectedVisibleId = order.includes(record.focusedAgentId) ? record.focusedAgentId : null
  return {
    version: 2,
    runId: record.runId,
    cwd: record.cwd,
    gitBranch: selectedVisibleId === null ? null : record.gitBranch,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    conversations,
    workspace: {
      conversations: workspaceConversations,
      order,
      selectedVisibleId,
    },
    handoffBundle: record.handoffBundle,
  }
}
