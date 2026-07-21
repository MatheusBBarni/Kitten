import { describe, expect, it } from "bun:test"

import { validateShowcaseSiteWorkflow } from "../../../scripts/validateShowcaseSiteWorkflow.ts"

type Step = {
  name?: string
  id?: string
  if?: string
  uses?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
  run?: string
}

type Job = {
  needs?: string | string[]
  environment?: { name?: string; url?: string }
  outputs?: Record<string, string>
  steps?: Step[]
}

type ShowcaseWorkflow = {
  on: {
    push: { branches: string[] }
    workflow_dispatch: Record<string, unknown>
  }
  permissions: Record<string, string>
  concurrency: { group: string; "cancel-in-progress": boolean }
  jobs: Record<string, Job>
}

const workflowSource = await Bun.file(
  new URL("../../../.github/workflows/showcase-site.yml", import.meta.url),
).text()
const workflow = Bun.YAML.parse(workflowSource) as ShowcaseWorkflow
const sitePackageSource = await Bun.file(new URL("../../../site/package.json", import.meta.url)).text()
const sitePackage = JSON.parse(sitePackageSource) as {
  scripts?: Record<string, string>
}
const build = workflow.jobs.build!
const deploy = workflow.jobs.deploy!

const findStep = (job: Job, name: string): Step | undefined =>
  job.steps?.find((step) => step.name === name)

describe("showcase site Pages workflow", () => {
  it("passes the reusable workflow contract validator", () => {
    expect(validateShowcaseSiteWorkflow(workflowSource, sitePackageSource)).toEqual([])
  })

  it("reports every required field when the workflow contract is empty", () => {
    const issues = validateShowcaseSiteWorkflow("on: {}\npermissions: {}\njobs: {}\n", '{"scripts":{}}')

    expect(issues).toHaveLength(17)
    expect(issues).toContain("push to main trigger is required")
    expect(issues).toContain("Pages artifact path must be site/dist")
    expect(issues).toContain("all required actions must be pinned to commits")
  })

  it("reports malformed workflow inputs without throwing", () => {
    expect(validateShowcaseSiteWorkflow("on: [", "{")).toEqual([
      "workflow YAML and site/package.json must parse",
    ])
  })

  it("parses as YAML and supports main pushes plus input-free manual runs", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] })
    expect(workflow.on.workflow_dispatch).toEqual({})
  })

  it("grants only the documented Pages permissions and serializes deployments", () => {
    expect(workflow.permissions).toEqual({
      contents: "read",
      pages: "write",
      "id-token": "write",
    })
    expect(workflow.concurrency).toEqual({
      group: "pages",
      "cancel-in-progress": false,
    })
  })

  it("pins every action to an immutable commit", () => {
    const actions = Object.values(workflow.jobs).flatMap((job) =>
      job.steps?.flatMap((step) => (step.uses ? [step.uses] : [])) ?? [],
    )

    expect(actions).toEqual([
      "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d",
      "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
      "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
    ])
    for (const action of actions) {
      expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/)
    }
  })

  it("installs and builds the site explicitly without Astro telemetry", () => {
    const install = findStep(build, "Install site dependencies")
    const buildSite = findStep(build, "Build site")

    expect(sitePackage.scripts?.build).toBe("astro build")
    expect(install?.run).toContain("cd site")
    expect(install?.run).toContain("bun install --frozen-lockfile")
    expect(buildSite?.env).toEqual({ ASTRO_TELEMETRY_DISABLED: "1" })
    expect(buildSite?.run).toContain("cd site")
    expect(buildSite?.run).toContain("bun run build")
  })

  it("fails before upload when the expected Astro artifact is missing", () => {
    const verifyOutput = findStep(build, "Verify Pages output")
    const upload = findStep(build, "Upload GitHub Pages artifact")

    expect(verifyOutput?.run).toContain("site/dist/index.html")
    expect(verifyOutput?.run).toContain("find site/dist -type f")
    expect(verifyOutput?.run).toContain("::error::")
    expect(upload?.with).toEqual({ path: "site/dist" })
    expect(build.steps!.indexOf(verifyOutput!)).toBeLessThan(build.steps!.indexOf(upload!))
  })

  it("deploys only after the Pages artifact exists and exposes the public URL", () => {
    const deploySite = findStep(deploy, "Deploy to GitHub Pages")
    const verifyDeployment = findStep(deploy, "Verify deployment output")

    expect(deploy.needs).toBe("build")
    expect(deploy.environment).toEqual({
      name: "github-pages",
      url: "${{ steps.deployment.outputs.page_url }}",
    })
    expect(deploy.outputs).toEqual({ page_url: "${{ steps.deployment.outputs.page_url }}" })
    expect(deploySite?.id).toBe("deployment")
    expect(verifyDeployment?.if).toBe("${{ always() }}")
    expect(verifyDeployment?.run).toContain("DEPLOYMENT_OUTCOME")
    expect(verifyDeployment?.run).toContain("PAGE_URL")
    expect(verifyDeployment?.run).toContain("GITHUB_STEP_SUMMARY")
  })

  it("does not depend on release state, prompts, secrets, or behavioral tracking", () => {
    expect(Object.keys(workflow.jobs)).toEqual(["build", "deploy"])
    expect(workflow.on.workflow_dispatch).not.toHaveProperty("inputs")
    expect(workflowSource).not.toMatch(/release_please|release\.yml|tag_name/i)
    expect(workflowSource).not.toMatch(/secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN|\bPAT\b/i)
    expect(workflowSource).not.toMatch(/google.analytics|segment|posthog|plausible|beacon/i)
  })
})
