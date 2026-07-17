import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PersistedRunRecordV4 } from "../src/persistence/runRecord.ts"
import { createRunWriter } from "../src/persistence/runWriter.ts"
import type { RunStore } from "../src/persistence/runStore.ts"
import { createAppStore } from "../src/store/appStore.ts"
import {
  createJsonlFileSink,
  createTelemetryRecorder,
  type SteeringOutcomeRecord,
} from "../src/telemetry/recorder.ts"

describe("privacy-safe steering observability", () => {
  it("writes one local content-free outcome while the run snapshot excludes live steering state", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-steering-observability-"))
    try {
      const telemetryPath = join(dir, "telemetry.jsonl")
      const records: PersistedRunRecordV4[] = []
      const runStore: RunStore = {
        save(record) {
          if (record.version !== 4) throw new Error("expected schema-neutral V4 snapshot")
          records.push(record)
        },
        list: () => [],
        load: () => null,
        delete() {},
        deleteAll() {},
        flush() {},
      }
      let flushSnapshot: (() => void) | undefined
      const store = createAppStore({
        seeds: [{
          id: "codex",
          providerKind: "codex",
          title: "Codex",
          cwd: "/safe/project",
        }],
        selectedVisibleId: "codex",
      })
      store.startSession("codex", "safe-acp-session")
      const writer = createRunWriter({
        enabled: true,
        runStore,
        projectCwd: "/safe/project",
        runId: "safe-run",
        now: () => 1_000,
        setTimer: (callback) => {
          flushSnapshot = callback
          return 1 as unknown as ReturnType<typeof setTimeout>
        },
        clearTimer: () => {
          flushSnapshot = undefined
        },
      })
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(telemetryPath),
        now: () => 1_000,
        sessionRef: "safe-run",
      })

      writer.watch(store)
      store.applyEvent("codex", {
        kind: "steering_enqueue",
        activeTurnId: "ACP_ID_SENTINEL",
        requestId: "REQUEST_ID_SENTINEL",
        generation: 1,
        blocks: [{ type: "text", text: "PROMPT_AND_RECOVERY_SENTINEL" }],
      })
      store.applyEvent("codex", {
        kind: "steering_recover",
        requestId: "REQUEST_ID_SENTINEL",
        generation: 1,
      })
      recorder.steeringOutcome("REQUEST_ID_SENTINEL", "recovered", "fallback")
      flushSnapshot?.()

      const telemetryRaw = readFileSync(telemetryPath, "utf8")
      const telemetry = JSON.parse(telemetryRaw.trim()) as SteeringOutcomeRecord
      expect(telemetry).toEqual({
        type: "steering_outcome",
        outcome: "recovered",
        capabilityClass: "fallback",
        durationBucket: "under_5s",
        at: 1_000,
        sessionRef: "safe-run",
      })
      expect(records).toHaveLength(1)
      expect(records[0]?.version).toBe(4)

      const persistedRaw = JSON.stringify(records[0])
      for (const sentinel of [
        "PROMPT_AND_RECOVERY_SENTINEL",
        "REQUEST_ID_SENTINEL",
        "ACP_ID_SENTINEL",
      ]) {
        expect(telemetryRaw).not.toContain(sentinel)
        expect(persistedRaw).not.toContain(sentinel)
      }
      expect(persistedRaw).not.toContain("steering")
      writer.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
