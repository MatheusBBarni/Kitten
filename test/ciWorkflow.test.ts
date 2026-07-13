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
  it("installs the independent showcase package before root tests build the site", () => {
    expect(workflow.jobs.verify.steps).toContainEqual({
      name: "Install showcase dependencies",
      "working-directory": "site",
      run: "bun install --frozen-lockfile",
    })
  })
})
