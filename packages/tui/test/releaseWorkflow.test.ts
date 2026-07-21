import { describe, expect, it } from "bun:test"

import { BUILD_TARGETS } from "../scripts/build.ts"

type Step = {
  name?: string
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
  env?: Record<string, string>
  strategy?: { matrix?: { include?: Array<Record<string, string>> } }
  steps?: Step[]
}

type Workflow = {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: Record<string, Job>
}

const source = await Bun.file(new URL("../../../.github/workflows/release.yml", import.meta.url)).text()
const workflow = Bun.YAML.parse(source) as Workflow
const releasePlease = workflow.jobs.release_please!
const build = workflow.jobs.build!
const attach = workflow.jobs.attach!
const publish = workflow.jobs.publish!
const smoke = workflow.jobs.smoke!
const releaseGate = "needs.release_please.outputs.release_created == 'true'"
const recoveryPublishGate =
  "always() && needs.release_please.outputs.release_created == 'true' && needs.build.result == 'success' && (needs.attach.result == 'success' || needs.attach.result == 'skipped')"

describe("consolidated release workflow", () => {
  it("parses as YAML and runs release-please on pushes to main", () => {
    expect(workflow.on).toHaveProperty("push")
    expect(workflow.on).not.toHaveProperty("release")
    expect(workflow.on.push).toEqual({ branches: ["main"] })

    expect(releasePlease.outputs).toEqual({
      release_created: "${{ steps.release.outputs.release_created || steps.fallback.outputs.release_created }}",
      tag_name: "${{ steps.release.outputs.tag_name || steps.fallback.outputs.tag_name }}",
      publish_only: "${{ steps.fallback.outputs.publish_only || 'false' }}",
    })

    const releaseStep = releasePlease.steps?.find((step) => step.id === "release")
    expect(releaseStep).toMatchObject({
      if: "github.event_name == 'push'",
      uses: "googleapis/release-please-action@5c625bfb5d1ff62eadeeb3772007f7f66fdcf071",
      with: {
        "config-file": "release-please-config.json",
        "manifest-file": ".release-please-manifest.json",
      },
    })
  })

  it("gates native builds on a newly exposed release and skips asset replacement during publish recovery", () => {
    expect(build.if).toBe(releaseGate)
    expect(attach.if).toBe(`${releaseGate} && needs.release_please.outputs.publish_only != 'true'`)
    expect(build.needs).toBe("release_please")
    expect(attach.needs).toEqual(["release_please", "build"])
  })

  it("gates publishing on every build and allows an intentionally skipped asset attachment during recovery", () => {
    expect(publish.if).toBe(recoveryPublishGate)
    expect(publish.needs).toEqual(["release_please", "build", "attach"])
    expect(smoke.if).toBe(releaseGate)
    expect(smoke.needs).toEqual(["release_please", "publish"])
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

  it("transfers each generated platform package from the same native build", () => {
    const upload = build.steps?.find((step) => step.uses === "actions/upload-artifact@v4")
    expect(upload?.with?.path).toContain("dist/npm/@matheusbbarni/kitten-${{ matrix.platform }}")
  })

  it("publishes all platform packages before the exact-pinned main shim", () => {
    const platformStep = publish.steps?.find((step) => step.name === "Publish platform packages")
    const mainStep = publish.steps?.find((step) => step.name === "Publish main package last")
    const platformIndex = publish.steps?.indexOf(platformStep!) ?? -1
    const mainIndex = publish.steps?.indexOf(mainStep!) ?? -1

    expect(platformIndex).toBeGreaterThan(-1)
    expect(mainIndex).toBeGreaterThan(platformIndex)
    expect(platformStep?.run).toContain("darwin-arm64 darwin-x64 linux-x64 linux-arm64")
    expect(platformStep?.run).toContain("@matheusbbarni/kitten-$platform")
    expect(platformStep?.run).toContain('chmod +x "$package_dir/kitten-$platform"')
    expect(platformStep?.run).toContain('npm publish "$package_dir" --provenance --access public')
    expect(mainStep?.run).toContain("pkg.optionalDependencies[name] = version")
    expect(mainStep?.run).toContain("npm publish . --provenance --access public")
  })

  it("normalizes component release tags before validating, polling, and smoking the published version", () => {
    const validateVersion = publish.steps?.find((step) => step.id === "version")
    const waitForPublish = smoke.steps?.find((step) => step.name === "Wait for the published shim")
    const runLauncher = smoke.steps?.find((step) => step.name === "Run the published launcher and verify provenance")

    expect(validateVersion?.run).toContain('^kitten-v[0-9]+\\.[0-9]+\\.[0-9]+$')
    expect(validateVersion?.run).toContain('tag_version="${TAG_NAME#kitten-v}"')
    expect(waitForPublish?.run).toContain('version="${TAG_NAME#kitten-v}"')
    expect(runLauncher?.run).toContain('VERSION="${TAG_NAME#kitten-v}"')
    expect(source).not.toContain("${TAG_NAME#v}")
  })

  it("uses the scoped npm publish token while retaining OIDC provenance on a supported toolchain", () => {
    expect(publish.permissions).toEqual({ contents: "read", "id-token": "write" })
    expect(publish.env).toEqual({ NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" })

    const setupNode = publish.steps?.find((step) => step.uses === "actions/setup-node@v4")
    expect(setupNode?.with).toMatchObject({
      "node-version": "24",
      "registry-url": "https://registry.npmjs.org",
    })

    const commands = publish.steps?.map((step) => step.run ?? "").join("\n") ?? ""
    expect(commands).toContain("npm install --global npm@11.5.1")
    expect(commands).toContain('gh api "repos/$GITHUB_REPOSITORY" --jq .visibility')
    expect(commands).toContain("npm provenance requires a public source repository")
    expect(source).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}")
  })

  it("smokes the published version and provenance on every platform without Bun", () => {
    const expectedRunners: Record<string, string> = {
      "darwin-arm64": "macos-15",
      "darwin-x64": "macos-15-intel",
      "linux-x64": "ubuntu-latest",
      "linux-arm64": "ubuntu-24.04-arm",
    }
    expect(smoke.strategy?.matrix?.include).toEqual(
      BUILD_TARGETS.map((target) => ({ platform: target.platform, runner: expectedRunners[target.platform]! })),
    )

    const commands = smoke.steps?.map((step) => step.run ?? "").join("\n") ?? ""
    const uses = smoke.steps?.map((step) => step.uses ?? "").join("\n") ?? ""
    expect(commands).toContain("command -v bun")
    expect(commands).toContain("npm audit signatures")
    expect(commands).toContain('npx --yes "@matheusbbarni/kitten@$VERSION" --version')
    expect(commands).toContain('npx --yes "@matheusbbarni/kitten@$VERSION" --self-check')
    expect(uses).toContain("actions/setup-node@v4")
    expect(uses).not.toContain("setup-bun")
  })

  it("guards workflow_dispatch with the component tag and supports publish-only recovery without asset replacement", () => {
    expect(workflow.on.workflow_dispatch).toEqual({
      inputs: {
        tag_name: {
          description: "Existing Kitten release tag to rebuild and publish",
          required: true,
          type: "string",
        },
        publish_only: {
          description: "Publish npm packages without replacing already-attached release assets",
          required: false,
          default: false,
          type: "boolean",
        },
      },
    })

    const fallback = releasePlease.steps?.find((step) => step.id === "fallback")
    expect(fallback?.if).toBe("github.event_name == 'workflow_dispatch'")
    expect(fallback?.run).toContain('^kitten-v[0-9]+\\.[0-9]+\\.[0-9]+$')
    expect(fallback?.run).toContain('version="${TAG_NAME#kitten-v}"')
    expect(fallback?.run).toContain('gh release view "$TAG_NAME"')
    expect(fallback?.run).toContain('npm view "@matheusbbarni/kitten@$version" version')
    expect(fallback?.run).toContain("expected_assets=(")
    expect(fallback?.run).toContain('grep -Fqx "$asset"')
    expect(fallback?.run).toContain('if [[ "$PUBLISH_ONLY" == "true" && "$asset_exists" != "true" ]]')
    expect(fallback?.run).toContain('if [[ "$PUBLISH_ONLY" != "true" && "$asset_exists" == "true" ]]')
    expect(fallback?.run).toContain('echo "release_created=true" >> "$GITHUB_OUTPUT"')
    expect(fallback?.run).toContain('echo "publish_only=$PUBLISH_ONLY" >> "$GITHUB_OUTPUT"')
  })

  it("derives the semver from the validated release-please kitten-v tag before publishing", () => {
    const versionStep = publish.steps?.find((step) => step.name === "Validate the release version")
    expect(versionStep?.run).toContain('^kitten-v[0-9]+\\.[0-9]+\\.[0-9]+$')
    expect(versionStep?.run).toContain('tag_version="${TAG_NAME#kitten-v}"')
  })

  it("keeps ordinary pushes release-only and limits publish credentials to the npm token", () => {
    expect(Object.keys(workflow.jobs)).toEqual(["release_please", "build", "attach", "publish", "smoke"])
    expect(workflow.permissions).toEqual({ contents: "write", issues: "write", "pull-requests": "write" })
    expect(source).toContain("secrets.NPM_TOKEN")
    expect(source).not.toMatch(/\bPAT\b|APP_TOKEN/i)
  })
})
