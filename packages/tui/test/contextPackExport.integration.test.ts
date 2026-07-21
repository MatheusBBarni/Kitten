import { describe, expect, it } from "bun:test"

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createContextPackExporter,
  renderContextPackMarkdown,
} from "../src/app/contextPackExport.ts"
import type { DurableSealedContextPack } from "../src/core/types.ts"

describe("Context Pack export filesystem integration", () => {
  it("writes the selected destination only after confirmation and never silently overwrites it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kitten-context-pack-export-"))
    const destination = join(directory, "confirmed-pack.md")
    const payload = "# Reviewed pack\n\nExact trailing whitespace stays here.  \n"
    const sealed: DurableSealedContextPack = {
      revision: 3,
      payload,
      bytes: new TextEncoder().encode(payload).byteLength,
      sealedAt: 123_456,
    }
    const exporter = createContextPackExporter()

    try {
      expect(await exporter.export({
        sealed,
        destination,
        writeConfirmed: false,
        overwriteConfirmed: false,
      })).toEqual({ kind: "blocked", reason: "confirmation_required" })
      await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" })

      expect(await exporter.export({
        sealed,
        destination,
        writeConfirmed: true,
        overwriteConfirmed: false,
      })).toMatchObject({ kind: "exported", payloadBytes: sealed.bytes })
      expect(await readFile(destination, "utf8")).toBe(renderContextPackMarkdown(sealed))

      await writeFile(destination, "existing operator file", "utf8")
      expect(await exporter.export({
        sealed,
        destination,
        writeConfirmed: true,
        overwriteConfirmed: false,
      })).toEqual({ kind: "blocked", reason: "overwrite_confirmation_required" })
      expect(await readFile(destination, "utf8")).toBe("existing operator file")

      expect(await exporter.export({
        sealed,
        destination,
        writeConfirmed: true,
        overwriteConfirmed: true,
      })).toMatchObject({ kind: "exported", payloadBytes: sealed.bytes })
      expect(await readFile(destination, "utf8")).toBe(renderContextPackMarkdown(sealed))
    } finally {
      await rm(directory, { recursive: true })
    }
  })
})
