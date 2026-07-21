import { expect, test } from "bun:test"

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ElicitationContentValue,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

import pkg from "../package.json" with { type: "json" }
import { spawnAgentTransport, type AgentTransport } from "../src/agent/transport.ts"
import {
  CLAUDE_CODE_ACP_PACKAGE,
  CODEX_ACP_PACKAGE,
  defaultAppConfig,
  findAgentConfig,
} from "../src/config/configLoader.ts"
import { CLARIFICATION_CONTRACT_SDK_VERSION } from "../src/config/clarificationCapability.ts"
import type { AgentConfig, ProviderKind } from "../src/core/types.ts"

const CONTRACT_ENABLED = process.env.KITTEN_CREDENTIALED_CLARIFICATION_CONTRACT === "1"
const CONTRACT_PROVIDER = parseContractProvider(process.env.KITTEN_CLARIFICATION_CONTRACT_PROVIDER)
const contractTest = test.skipIf(!CONTRACT_ENABLED)

const ROUND_TIMEOUT_MS = 120_000
const CONTRACT_TIMEOUT_MS = 300_000

/**
 * Opt-in contract gate for the real, credentialed built-in adapter recipe.
 *
 * Run explicitly with:
 *
 * `KITTEN_CREDENTIALED_CLARIFICATION_CONTRACT=1 \
 *  KITTEN_CLARIFICATION_CONTRACT_PROVIDER=claude-code \
 *  bun test test/clarificationAdapter.contract.test.ts`
 *
 * The process must already be authenticated for the selected provider. This test
 * intentionally uses the exact resolved `npx -y package@version` recipe rather
 * than an in-memory agent or the dev-dependency binary.
 */
contractTest(
  "credentialed built-in adapter advertises, requests, accepts, cancels, and completes cleanly",
  async () => {
    const config = verifiedPackagePins(CONTRACT_PROVIDER)
    const transcript: string[] = []
    const requests: CreateElicitationRequest[] = []
    let responseMode: "accept" | "cancel" = "accept"
    let acceptedResponseContent: Record<string, ElicitationContentValue> | undefined
    let transport: AgentTransport | undefined
    let disposing = false
    let closedUnexpectedly = false

    const client: Client = {
      sessionUpdate(params: SessionNotification): void {
        const update = params.update
        if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") return
        transcript.push(update.content.text)
      },
      requestPermission(_params: RequestPermissionRequest): RequestPermissionResponse {
        return { outcome: { outcome: "cancelled" } }
      },
      readTextFile(_params: ReadTextFileRequest): ReadTextFileResponse {
        throw new Error("The clarification contract does not authorize file reads")
      },
      writeTextFile(_params: WriteTextFileRequest): WriteTextFileResponse {
        throw new Error("The clarification contract does not authorize file writes")
      },
      unstable_createElicitation(params: CreateElicitationRequest): CreateElicitationResponse {
        requests.push(params)
        if (responseMode === "cancel") return { action: "cancel" }
        acceptedResponseContent = acceptedContent(params)
        return { action: "accept", content: acceptedResponseContent }
      },
    }

    try {
      transport = spawnAgentTransport(config)
      transport.onClose(() => {
        if (!disposing) closedUnexpectedly = true
      })
      const connection = new ClientSideConnection(() => client, transport.stream)

      const initialized = await withTimeout(
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            elicitation: { form: {} },
          },
          clientInfo: { name: "kitten-clarification-contract", version: "0.0.0" },
        }),
        ROUND_TIMEOUT_MS,
        "initialize",
      )
      expect(initialized.protocolVersion).toBe(PROTOCOL_VERSION)

      const session = await withTimeout(
        connection.newSession({ cwd: process.cwd(), mcpServers: [] }),
        ROUND_TIMEOUT_MS,
        "session/new",
      )

      const acceptedStart = requests.length
      responseMode = "accept"
      const acceptedTurn = await withTimeout(
        connection.prompt({
          sessionId: session.sessionId,
          prompt: [
            {
              type: "text",
              text:
                "Use your structured user-question tool now. Ask exactly one single-select question with " +
                "the options Alpha and Beta. After the user answers, acknowledge the selected value and finish. " +
                "Do not read or write files and do not run commands.",
            },
          ],
        }),
        ROUND_TIMEOUT_MS,
        "accepted clarification turn",
      )
      expect(requests.length).toBeGreaterThan(acceptedStart)
      expect(requests.at(-1)).toMatchObject({ mode: "form", sessionId: session.sessionId })
      expect(Object.keys(acceptedResponseContent ?? {})).not.toHaveLength(0)
      expect(acceptedTurn.stopReason).toBeDefined()

      const cancelledStart = requests.length
      responseMode = "cancel"
      const cancelledTurn = await withTimeout(
        connection.prompt({
          sessionId: session.sessionId,
          prompt: [
            {
              type: "text",
              text:
                "Use your structured user-question tool once more. Ask exactly one single-select question with " +
                "the options Continue and Stop. If the user cancels, handle that terminal outcome and finish cleanly. " +
                "Do not read or write files and do not run commands.",
            },
          ],
        }),
        ROUND_TIMEOUT_MS,
        "cancelled clarification turn",
      )
      expect(requests.length).toBeGreaterThan(cancelledStart)
      expect(requests.at(-1)).toMatchObject({ mode: "form", sessionId: session.sessionId })
      expect(cancelledTurn.stopReason).toBeDefined()
      expect(closedUnexpectedly).toBe(false)
      expect(transcript.join("").length).toBeGreaterThan(0)
    } finally {
      disposing = true
      if (transport) await transport.dispose()
    }
  },
  CONTRACT_TIMEOUT_MS,
)

function verifiedPackagePins(provider: ProviderKind): AgentConfig {
  const config = findAgentConfig(defaultAppConfig(), provider)
  if (!config) throw new Error(`Missing built-in provider recipe: ${provider}`)

  const dependencies = pkg.dependencies as Record<string, string>
  const devDependencies = pkg.devDependencies as Record<string, string>
  expect(dependencies["@agentclientprotocol/sdk"]).toBe(CLARIFICATION_CONTRACT_SDK_VERSION)

  const packageSpec = provider === "claude-code" ? CLAUDE_CODE_ACP_PACKAGE : CODEX_ACP_PACKAGE
  const separator = packageSpec.lastIndexOf("@")
  const packageName = packageSpec.slice(0, separator)
  const version = packageSpec.slice(separator + 1)
  expect(devDependencies[packageName]).toBe(version)
  expect(config.command).toBe("npx")
  expect(config.args).toEqual(["-y", packageSpec])
  return config
}

function acceptedContent(params: CreateElicitationRequest): Record<string, ElicitationContentValue> {
  if (params.mode !== "form") throw new Error(`Expected form elicitation, received ${params.mode}`)
  const requestedSchema = params.requestedSchema
  if (!isRecord(requestedSchema) || !isRecord(requestedSchema.properties)) {
    throw new Error("Expected form elicitation with an object properties schema")
  }

  const content: Record<string, ElicitationContentValue> = {}
  for (const [fieldId, schema] of Object.entries(requestedSchema.properties)) {
    if (fieldId.endsWith("_custom")) continue
    const raw = schema as Record<string, unknown>
    const oneOf = Array.isArray(raw.oneOf) ? raw.oneOf : []
    const enumValues = Array.isArray(raw.enum) ? raw.enum : []
    const firstOneOf = oneOf[0] as Record<string, unknown> | undefined
    const candidate = firstOneOf?.const ?? enumValues[0]

    if (raw.type === "array") {
      const items = raw.items as Record<string, unknown> | undefined
      const anyOf = Array.isArray(items?.anyOf) ? items.anyOf : []
      const first = anyOf[0] as Record<string, unknown> | undefined
      content[fieldId] = [typeof first?.const === "string" ? first.const : "Alpha"]
    } else {
      content[fieldId] = typeof candidate === "string" ? candidate : "contract accepted"
    }
  }
  return content
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function parseContractProvider(value: string | undefined): ProviderKind {
  if (value === undefined || value === "") return "claude-code"
  if (value === "claude-code" || value === "codex") return value
  throw new Error(`KITTEN_CLARIFICATION_CONTRACT_PROVIDER must be "claude-code" or "codex", received: ${value}`)
}
