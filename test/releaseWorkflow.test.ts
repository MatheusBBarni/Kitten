import { describe, expect, it } from "bun:test"

import { BUILD_TARGETS } from "../scripts/build.ts"

type Step = {
  id?: string
  if?: string
  uses?: string
  with?: Record<string, unknown>
  run?: string
}

type Job = {
  if?: string
  needs?: string | string[]
  outputs?: Record<string, string>
  permissions?: Record<string, string>
  strategy?: { matrix?: { include?: Array<Record<string, string>> } }
  steps?: Step[]
}

type Workflow = {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: Record<string, Job>
}

const source = await Bun.file(new URL("../.github/workflows/release.yml", import.meta.url)).text()
const workflow = Bun.YAML.parse(source) as Workflow
const releasePlease = workflow.jobs.release_please!
const build = workflow.jobs.build!
const attach = workflow.jobs.attach!
const releaseGate = "needs.release_please.outputs.release_created == 'true'"

describe("consolidated release workflow", () => {
  it("parses as YAML and runs release-please on pushes to main", () => {
    expect(workflow.on).toHaveProperty("push")
    expect(workflow.on).not.toHaveProperty("release")
    expect(workflow.on.push).toEqual({ branches: ["main"] })

    expect(releasePlease.outputs).toEqual({
      release_created: "${{ steps.release.outputs.release_created || steps.fallback.outputs.release_created }}",
      tag_name: "${{ steps.release.outputs.tag_name || steps.fallback.outputs.tag_name }}",
    })

    const releaseStep = releasePlease.steps?.find((step) => step.id === "release")
    expect(releaseStep).toMatchObject({
      if: "github.event_name == 'push'",
      uses: "googleapis/release-please-action@v4",
      with: {
        "config-file": "release-please-config.json",
        "manifest-file": ".release-please-manifest.json",
      },
    })
  })

  it("gates native build and attachment jobs on a newly exposed release", () => {
    expect(build.if).toBe(releaseGate)
    expect(attach.if).toBe(releaseGate)
    expect(build.needs).toBe("release_please")
    expect(attach.needs).toEqual(["release_please", "build"])
  })

  it("matches BUILD_TARGETS to the four native GitHub runners", () => {
    const expectedRunners: Record<string, string> = {
      "darwin-arm64": "macos-15",
      "darwin-x64": "macos-15-intel",
      "linux-x64": "ubuntu-latest",
      "linux-arm64": "ubuntu-24.04-arm",
    }
    const matrix = build.strategy?.matrix?.include

    expect(matrix).toEqual(
      BUILD_TARGETS.map((target) => ({ platform: target.platform, runner: expectedRunners[target.platform]! })),
    )

    const buildCommands = build.steps?.map((step) => step.run ?? "").join("\n") ?? ""
    expect(buildCommands).toContain("bun run scripts/build.ts ${{ matrix.platform }}")
    expect(buildCommands).toContain("./dist/kitten-${{ matrix.platform }} --self-check")
  })

  it("assembles and uploads four binaries plus one combined checksum manifest", () => {
    const commands = attach.steps?.map((step) => step.run ?? "").join("\n") ?? ""
    expect(commands).toContain("sha256sum kitten-* > SHA256SUMS")
    expect(commands).toContain('gh release upload "$TAG_NAME" dist/kitten-* dist/SHA256SUMS')
    expect(commands).toContain("kitten-darwin-arm64")
    expect(commands).toContain("kitten-darwin-x64")
    expect(commands).toContain("kitten-linux-x64")
    expect(commands).toContain("kitten-linux-arm64")
  })

  it("guards workflow_dispatch from attaching an expected asset twice", () => {
    expect(workflow.on.workflow_dispatch).toEqual({
      inputs: {
        tag_name: {
          description: "Existing GitHub Release tag to rebuild and attach",
          required: true,
          type: "string",
        },
      },
    })

    const fallback = releasePlease.steps?.find((step) => step.id === "fallback")
    expect(fallback?.if).toBe("github.event_name == 'workflow_dispatch'")
    expect(fallback?.run).toContain('gh release view "$TAG_NAME"')
    expect(fallback?.run).toContain("expected_assets=(")
    expect(fallback?.run).toContain('grep -Fqx "$asset"')
    expect(fallback?.run).toContain('echo "release_created=true" >> "$GITHUB_OUTPUT"')
  })

  it("keeps ordinary pushes release-only and references no elevated or npm token", () => {
    expect(Object.keys(workflow.jobs)).toEqual(["release_please", "build", "attach"])
    expect(workflow.permissions).toEqual({ contents: "write" })
    expect(source).not.toMatch(/NPM_TOKEN|\bPAT\b|APP_TOKEN|id-token/i)
    expect(source).not.toContain("secrets.")
  })
})
