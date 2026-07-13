import { describe, expect, it } from "bun:test"

type Step = {
  name?: string
  run?: string
  "working-directory"?: string
}

type Workflow = {
  jobs: {
    verify: {
      steps: Step[]
    }
  }
}

const source = await Bun.file(new URL("../.github/workflows/ci.yml", import.meta.url)).text()
const workflow = Bun.YAML.parse(source) as Workflow

describe("CI workflow", () => {
  it("resolves the README install channel before installing root dependencies", () => {
    const steps = workflow.jobs.verify.steps
    const resolveIndex = steps.findIndex(
      (step) => step.name === "Resolve README install channel",
    )
    const installIndex = steps.findIndex(
      (step) =>
        step.run === "bun install --frozen-lockfile" &&
        step["working-directory"] === undefined,
    )

    expect(steps[resolveIndex]).toEqual({
      name: "Resolve README install channel",
      run: "bun run scripts/check-readme-install.ts README.md",
    })
    expect(resolveIndex).toBeGreaterThanOrEqual(0)
    expect(resolveIndex).toBeLessThan(installIndex)
  })

  it("installs the independent showcase package before root tests build the site", () => {
    expect(workflow.jobs.verify.steps).toContainEqual({
      name: "Install showcase dependencies",
      "working-directory": "site",
      run: "bun install --frozen-lockfile",
    })
  })
})
