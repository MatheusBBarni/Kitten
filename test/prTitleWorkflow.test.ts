import { describe, expect, it } from "bun:test"
import { YAML } from "bun"
import { readFileSync } from "node:fs"

interface WorkflowStep {
  uses?: string
  with?: Record<string, string>
}

interface PrTitleWorkflow {
  on: {
    pull_request: {
      types: string[]
    }
  }
  jobs: Record<string, { steps: WorkflowStep[] }>
}

const workflowText = readFileSync(
  new URL("../.github/workflows/pr-title.yml", import.meta.url),
  "utf8",
)
const workflow = YAML.parse(workflowText) as PrTitleWorkflow
const semanticStep = Object.values(workflow.jobs)
  .flatMap((job) => job.steps)
  .find((step) => step.uses?.startsWith("amannn/action-semantic-pull-request@"))

if (!semanticStep?.uses || !semanticStep.with) {
  throw new Error("semantic pull-request action step is missing or incomplete")
}

const allowedTypes = semanticStep.with.types?.trim().split(/\s+/) ?? []
const headerPattern = new RegExp(semanticStep.with.headerPattern ?? "")

function acceptsTitle(title: string): boolean {
  const match = headerPattern.exec(title)
  return match !== null && match[1] !== undefined && allowedTypes.includes(match[1])
}

describe("PR title workflow", () => {
  it("parses as YAML and runs for each required pull_request event", () => {
    expect(workflow.on.pull_request.types).toEqual(["opened", "edited", "synchronize"])
  })

  it("allows the standard Conventional Commit types", () => {
    expect(allowedTypes).toEqual([
      "feat",
      "fix",
      "chore",
      "docs",
      "refactor",
      "test",
      "ci",
      "build",
      "perf",
      "revert",
    ])
  })

  it("accepts the breaking marker and rejects a non-conventional title", () => {
    expect(acceptsTitle("chore: x")).toBe(true)
    expect(acceptsTitle("feat!: remove the legacy API")).toBe(true)
    expect(acceptsTitle("nonsense")).toBe(false)
  })

  it("pins the semantic pull-request action to a specific version", () => {
    expect(semanticStep.uses).toBe("amannn/action-semantic-pull-request@v6.1.1")
    expect(semanticStep.uses).toMatch(/@v\d+\.\d+\.\d+$/)
  })
})
