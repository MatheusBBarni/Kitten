import { describe, expect, it } from "bun:test"

import type { ResolvedSession } from "../core/types.ts"
import {
  HARNESS_DELIVERY_CHECKPOINT_SCHEMA,
  PERSISTED_CONTEXT_PACK_SCHEMA,
  PERSISTED_RUN_RECORD_SCHEMA,
  PERSISTED_RUN_RECORD_V4_SCHEMA,
  migratePersistedRunToV4,
  migratePersistedRunV1,
  type PersistedContextPack,
  type PersistedRunRecordV1,
  type PersistedRunRecordV2,
  type PersistedRunRecordV3,
  type PersistedRunRecordV4,
} from "./runRecord.ts"

const DIGEST = "a".repeat(64)

describe("persisted harness delivery checkpoint", () => {
  it("accepts only fixed settled-interrupted metadata", () => {
    const checkpoint = {
      version: "v1",
      generation: 7,
      state: "settled_interrupted",
    } as const
    const parsed = HARNESS_DELIVERY_CHECKPOINT_SCHEMA.parse(checkpoint)

    expect(parsed).toEqual(checkpoint)
    expect(Object.keys(parsed).sort()).toEqual(["generation", "state", "version"])
    for (const extra of [
      { failureCategory: "dispatch_indeterminate" },
      { blocks: [{ type: "text", text: "DRAFT_SENTINEL" }] },
      { requestId: "REQUEST_ID_SENTINEL" },
      { sessionId: "SESSION_ID_SENTINEL" },
      { acpSessionId: "ACP_SESSION_ID_SENTINEL" },
      { recovery: "RECOVERY_SENTINEL" },
      { providerError: "PROVIDER_ERROR_SENTINEL" },
      { rawError: "RAW_ERROR_SENTINEL" },
      { unknown: true },
    ]) {
      expect(HARNESS_DELIVERY_CHECKPOINT_SCHEMA.safeParse({ ...checkpoint, ...extra }).success).toBe(false)
    }
  })
})

function v2(): PersistedRunRecordV2 {
  return {
    version: 2,
    runId: "run-v2",
    cwd: "/work/kitten",
    gitBranch: "feat/context",
    createdAt: 1,
    updatedAt: 2,
    conversations: {
      owner: {
        sessionId: "owner",
        providerKind: "codex",
        cwd: "/work/kitten",
        initialTitle: "Owner",
        acpSessionId: "acp-owner",
        lastPrompt: "persist context",
        messageCount: 1,
        status: "idle",
      },
    },
    workspace: {
      conversations: {
        owner: {
          sessionId: "owner",
          displayName: "Owner",
          lifecycle: "visible",
          createdOrdinal: 0,
          attention: { seen: true, sequence: 0 },
        },
      },
      order: ["owner"],
      selectedVisibleId: "owner",
    },
    handoffBundle: null,
  }
}

function v1(): PersistedRunRecordV1 {
  return {
    version: 1,
    runId: "run-v1",
    cwd: "/work/kitten",
    gitBranch: "feat/context",
    focusedAgentId: "owner",
    createdAt: 1,
    updatedAt: 2,
    agents: {
      owner: {
        sessionId: "acp-owner",
        lastPrompt: "persist context",
        messageCount: 1,
        status: "idle",
      },
    },
    handoffBundle: null,
  }
}

function resolvedOwner(): ResolvedSession {
  return {
    seed: { id: "owner", providerKind: "codex", title: "Owner", cwd: "/work/kitten" },
    spawn: {
      id: "codex",
      displayName: "Codex",
      command: "codex-acp",
      args: [],
      env: {},
      clarificationCapability: { status: "unsupported", reason: "unknown_recipe" },
      hardStopContinuationCapability: { status: "unavailable", reason: "unknown_recipe" },
      steeringCapability: { status: "unavailable" },
      runtimeProfile: { kind: "standard" },
    },
  }
}

function contextPack(payload = "line one\r\nline two café e\u0301"): PersistedContextPack {
  return {
    draft: {
      version: 1,
      revision: 7,
      instructions: { original: "Implement persistence", mode: "augment", discovered: "" },
      budget: { unit: "estimated_tokens", limit: 80_000 },
      brief: {
        architecture: "Core then store",
        selectedContext: "Persistence files",
        relationships: "Writer feeds store",
        ambiguities: "None",
        budgetOmissions: "None",
      },
      selections: [{
        kind: "full_file",
        path: "src/persistence/runRecord.ts",
        source: { identity: "blob:run-record", digest: DIGEST, bytes: 42 },
        rationale: "Defines the record",
        relationship: "Owns the boundary",
      }],
    },
    sealed: {
      payload,
      bytes: new TextEncoder().encode(payload).byteLength,
      revision: 7,
      sealedAt: 1234,
    },
  }
}

function v4(): PersistedRunRecordV4 {
  const migrated = migratePersistedRunToV4(v2())
  return { ...migrated, contextPacks: { owner: contextPack() } }
}

describe("persisted RunRecord V4 Context Packs", () => {
  it("migrates accepted V1-V3 records into an empty V4 Context Pack projection", () => {
    const migratedV1 = migratePersistedRunToV4(migratePersistedRunV1(v1(), [resolvedOwner()]))
    const sourceV2 = v2()
    const sourceV3: PersistedRunRecordV3 = {
      ...sourceV2,
      version: 3,
      harnessDeliveries: { owner: { version: "v1", generation: 1, state: "delivered" } },
    }

    for (const migrated of [
      migratedV1,
      migratePersistedRunToV4(sourceV2),
      migratePersistedRunToV4(sourceV3),
    ]) {
      expect(migrated.version).toBe(4)
      expect(migrated.contextPacks).toEqual({})
      expect(PERSISTED_RUN_RECORD_SCHEMA.safeParse(migrated).success).toBe(true)
    }
    expect(migratePersistedRunToV4(sourceV3).harnessDeliveries.owner?.state).toBe("delivered")
  })

  it("accepts only the allowlisted V4 projection and exact sealed payload fields", () => {
    const parsed = PERSISTED_RUN_RECORD_V4_SCHEMA.parse(v4())
    expect(Object.keys(parsed.contextPacks.owner!).sort()).toEqual(["draft", "sealed"])
    expect(Object.keys(parsed.contextPacks.owner!.sealed!).sort()).toEqual([
      "bytes",
      "payload",
      "revision",
      "sealedAt",
    ])
    expect(parsed.contextPacks.owner!.sealed!.payload).toBe(contextPack().sealed!.payload)
  })

  it("rejects raw source, review candidates, routes, evidence, reservations, errors, and extras", () => {
    for (const field of [
      "rawSource",
      "reviewCandidate",
      "bridgeRoute",
      "attestation",
      "profile",
      "reservation",
      "providerError",
      "arbitraryExtra",
    ]) {
      const projection = structuredClone(contextPack()) as PersistedContextPack & Record<string, unknown>
      projection[field] = field === "rawSource" ? "private source bytes" : { private: true }
      expect(PERSISTED_CONTEXT_PACK_SCHEMA.safeParse(projection).success).toBe(false)
    }

    const sourceExtra = structuredClone(contextPack()) as unknown as {
      draft: { selections: Array<{ source: Record<string, unknown> }> }
    }
    sourceExtra.draft.selections[0]!.source.content = "private source bytes"
    expect(PERSISTED_CONTEXT_PACK_SCHEMA.safeParse(sourceExtra).success).toBe(false)
  })

  it("round-trips exact redacted bytes without newline or Unicode normalization", () => {
    const payload = "first\r\nsecond\ncomposed é / decomposed e\u0301 / [REDACTED]"
    const record = { ...v4(), contextPacks: { owner: contextPack(payload) } }
    const serialized = JSON.stringify(PERSISTED_RUN_RECORD_SCHEMA.parse(record))
    const restored = PERSISTED_RUN_RECORD_SCHEMA.parse(JSON.parse(serialized))
    expect(restored.version).toBe(4)
    if (restored.version !== 4) throw new Error("expected V4")
    expect(restored.contextPacks.owner!.sealed!.payload).toBe(payload)
    expect(restored.contextPacks.owner!.sealed!.bytes).toBe(new TextEncoder().encode(payload).byteLength)
  })

  it("rejects a sealed byte count that does not match the exact payload", () => {
    const record = v4()
    record.contextPacks.owner!.sealed!.bytes += 1
    expect(PERSISTED_RUN_RECORD_SCHEMA.safeParse(record).success).toBe(false)
  })

  it("rejects a structurally valid draft with an unsafe source path", () => {
    const projection = contextPack()
    projection.draft!.selections[0]!.path = "../private-source.ts"
    expect(PERSISTED_CONTEXT_PACK_SCHEMA.safeParse(projection).success).toBe(false)
  })
})
