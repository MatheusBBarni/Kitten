import { describe, expect, it } from "bun:test"

import type { DurableSealedContextPack } from "../core/types.ts"
import {
  createContextPackExporter,
  renderContextPackMarkdown,
  type ContextPackExportRequest,
  type ContextPackExportWriter,
} from "./contextPackExport.ts"

const payload = "# Exact payload\n\n  keep leading spaces  \n[REDACTED]\n終"
const sealed: DurableSealedContextPack = {
  revision: 7,
  payload,
  bytes: new TextEncoder().encode(payload).byteLength,
  sealedAt: 1_750_000_000_123,
}

function request(overrides: Partial<ContextPackExportRequest> = {}): ContextPackExportRequest {
  return {
    sealed,
    destination: "/chosen/context-pack.md",
    writeConfirmed: true,
    overwriteConfirmed: false,
    ...overrides,
  }
}

describe("Context Pack Markdown export", () => {
  it("renders only compact provenance followed by the exact sealed payload", () => {
    const rendered = renderContextPackMarkdown(sealed)

    expect(rendered).toBe(
      `<!-- kitten-context-pack revision=7 sealed-at-ms=1750000000123 payload-bytes=${sealed.bytes} -->\n\n${payload}`,
    )
    expect(rendered.slice(rendered.indexOf(payload))).toBe(payload)
    expect(rendered).not.toContain("recipient")
    expect(rendered).not.toContain("fit")
  })

  it("passes the rendered bytes and exact selected destination without normalization", async () => {
    const writes: unknown[] = []
    const writer: ContextPackExportWriter = {
      async write(destination, markdown, mode) {
        writes.push({ destination, markdown, mode })
      },
    }

    const result = await createContextPackExporter(writer).export(request({
      destination: "/chosen/../chosen/context-pack.md",
    }))

    expect(result).toEqual({
      kind: "exported",
      payloadBytes: sealed.bytes,
      exportBytes: new TextEncoder().encode(renderContextPackMarkdown(sealed)).byteLength,
    })
    expect(writes).toEqual([{
      destination: "/chosen/../chosen/context-pack.md",
      markdown: renderContextPackMarkdown(sealed),
      mode: "create",
    }])
  })

  it("requires an exact sealed payload, destination, and explicit write confirmation", async () => {
    let writes = 0
    const exporter = createContextPackExporter({
      async write() {
        writes += 1
      },
    })

    expect(await exporter.export(request({
      sealed: { ...sealed, bytes: sealed.bytes + 1 },
    }))).toEqual({ kind: "blocked", reason: "sealed_payload_invalid" })
    expect(await exporter.export(request({ destination: "  " }))).toEqual({
      kind: "blocked",
      reason: "destination_required",
    })
    expect(await exporter.export(request({ writeConfirmed: false }))).toEqual({
      kind: "blocked",
      reason: "confirmation_required",
    })
    expect(writes).toBe(0)
  })

  it("requires independent overwrite confirmation when exclusive creation finds a file", async () => {
    const modes: string[] = []
    const exporter = createContextPackExporter({
      async write(_destination, _markdown, mode) {
        modes.push(mode)
        if (mode === "create") throw Object.assign(new Error("private raw path"), { code: "EEXIST" })
      },
    })

    expect(await exporter.export(request())).toEqual({
      kind: "blocked",
      reason: "overwrite_confirmation_required",
    })
    expect(await exporter.export(request({ overwriteConfirmed: true }))).toMatchObject({
      kind: "exported",
      payloadBytes: sealed.bytes,
    })
    expect(modes).toEqual(["create", "overwrite"])
  })

  it("bounds filesystem failures without returning raw error text", async () => {
    const exporter = createContextPackExporter({
      async write() {
        throw new Error("EACCES /secret/operator/path context payload")
      },
    })

    const result = await exporter.export(request())

    expect(result).toEqual({ kind: "blocked", reason: "filesystem_failure" })
    expect(JSON.stringify(result)).not.toContain("EACCES")
    expect(JSON.stringify(result)).not.toContain("/secret/operator/path")
    expect(JSON.stringify(result)).not.toContain("context payload")
  })
})
