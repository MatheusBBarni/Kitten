import { writeFile } from "node:fs/promises"

import type { DurableSealedContextPack } from "../core/types.ts"

export type ContextPackExportFailureReason =
  | "sealed_payload_invalid"
  | "destination_required"
  | "confirmation_required"
  | "overwrite_confirmation_required"
  | "filesystem_failure"

export interface ContextPackExportRequest {
  readonly sealed: DurableSealedContextPack
  /** Exact operator-selected destination. The exporter never derives or normalizes it. */
  readonly destination: string
  /** Independent confirmation for starting this filesystem write. */
  readonly writeConfirmed: boolean
  /** Independent confirmation for replacing an existing destination. */
  readonly overwriteConfirmed: boolean
}

export type ContextPackExportResult =
  | {
      readonly kind: "exported"
      readonly payloadBytes: number
      readonly exportBytes: number
    }
  | {
      readonly kind: "blocked"
      readonly reason: ContextPackExportFailureReason
    }

export interface ContextPackExportWriter {
  write(
    destination: string,
    markdown: string,
    mode: "create" | "overwrite",
  ): Promise<void>
}

export interface ContextPackExporter {
  export(request: ContextPackExportRequest): Promise<ContextPackExportResult>
}

const productionWriter: ContextPackExportWriter = {
  async write(destination, markdown, mode) {
    await writeFile(destination, markdown, {
      encoding: "utf8",
      // Exclusive creation is the final race-safe no-overwrite boundary.
      flag: mode === "overwrite" ? "w" : "wx",
    })
  },
}

/** Compact recipient-neutral provenance followed by the sealed payload unchanged. */
export function renderContextPackMarkdown(sealed: DurableSealedContextPack): string {
  return `<!-- kitten-context-pack revision=${sealed.revision} sealed-at-ms=${sealed.sealedAt} payload-bytes=${sealed.bytes} -->\n\n${sealed.payload}`
}

/** Create the sole filesystem authority for confirmed Context Pack export. */
export function createContextPackExporter(
  writer: ContextPackExportWriter = productionWriter,
): ContextPackExporter {
  return {
    async export(request): Promise<ContextPackExportResult> {
      if (!isExactSealedPayload(request.sealed)) {
        return { kind: "blocked", reason: "sealed_payload_invalid" }
      }
      if (request.destination.trim().length === 0) {
        return { kind: "blocked", reason: "destination_required" }
      }
      if (!request.writeConfirmed) {
        return { kind: "blocked", reason: "confirmation_required" }
      }

      const markdown = renderContextPackMarkdown(request.sealed)
      try {
        await writer.write(
          request.destination,
          markdown,
          request.overwriteConfirmed ? "overwrite" : "create",
        )
      } catch (error) {
        return isExistingDestinationError(error) && !request.overwriteConfirmed
          ? { kind: "blocked", reason: "overwrite_confirmation_required" }
          : { kind: "blocked", reason: "filesystem_failure" }
      }

      return {
        kind: "exported",
        payloadBytes: request.sealed.bytes,
        exportBytes: utf8Bytes(markdown),
      }
    },
  }
}

function isExactSealedPayload(sealed: DurableSealedContextPack): boolean {
  return Number.isSafeInteger(sealed.revision) &&
    sealed.revision >= 0 &&
    Number.isSafeInteger(sealed.bytes) &&
    sealed.bytes >= 0 &&
    Number.isFinite(sealed.sealedAt) &&
    sealed.sealedAt >= 0 &&
    utf8Bytes(sealed.payload) === sealed.bytes
}

function isExistingDestinationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST"
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
