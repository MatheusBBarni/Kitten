type Step = {
  name?: string
  id?: string
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

type Workflow = {
  on?: { push?: { branches?: string[] }; workflow_dispatch?: Record<string, unknown> }
  permissions?: Record<string, string>
  jobs?: Record<string, Job>
}

const requiredActions = [
  "actions/checkout",
  "oven-sh/setup-bun",
  "actions/configure-pages",
  "actions/upload-pages-artifact",
  "actions/deploy-pages",
]

export function validateShowcaseSiteWorkflow(
  workflowSource: string,
  packageSource: string,
): string[] {
  let workflow: Workflow
  let sitePackage: { scripts?: Record<string, string> }

  try {
    workflow = Bun.YAML.parse(workflowSource) as Workflow
    sitePackage = JSON.parse(packageSource) as { scripts?: Record<string, string> }
  } catch {
    return ["workflow YAML and site/package.json must parse"]
  }

  const issues: string[] = []
  const build = workflow.jobs?.build
  const deploy = workflow.jobs?.deploy
  const steps = [...(build?.steps ?? []), ...(deploy?.steps ?? [])]
  const step = (name: string): Step | undefined => steps.find((candidate) => candidate.name === name)
  const uses = steps.flatMap((candidate) => (candidate.uses ? [candidate.uses] : []))
  const require = (condition: boolean, message: string): void => {
    if (!condition) issues.push(message)
  }

  require(workflow.on?.push?.branches?.includes("main") === true, "push to main trigger is required")
  require(
    workflow.on?.workflow_dispatch !== undefined &&
      Object.keys(workflow.on.workflow_dispatch).length === 0,
    "input-free workflow_dispatch trigger is required",
  )
  require(workflow.permissions?.contents === "read", "contents: read permission is required")
  require(workflow.permissions?.pages === "write", "pages: write permission is required")
  require(workflow.permissions?.["id-token"] === "write", "id-token: write permission is required")
  require(sitePackage.scripts?.build === "astro build", "site build script must run astro build")
  require(step("Install site dependencies")?.run?.includes("cd site") === true, "install must cd site")
  require(
    step("Install site dependencies")?.run?.includes("bun install --frozen-lockfile") === true,
    "install must use the frozen lockfile",
  )
  require(step("Build site")?.run?.includes("bun run build") === true, "workflow must build the site")
  require(
    step("Build site")?.env?.ASTRO_TELEMETRY_DISABLED === "1",
    "Astro telemetry must be disabled",
  )
  require(
    step("Verify Pages output")?.run?.includes("site/dist/index.html") === true,
    "workflow must verify site/dist/index.html",
  )
  require(
    step("Upload GitHub Pages artifact")?.with?.path === "site/dist",
    "Pages artifact path must be site/dist",
  )
  require(deploy?.needs === "build", "deploy job must depend on build")
  require(deploy?.environment?.name === "github-pages", "deploy must target github-pages")
  require(
    deploy?.environment?.url === "${{ steps.deployment.outputs.page_url }}",
    "deploy environment must expose page_url",
  )
  require(
    step("Verify deployment output")?.run?.includes("GITHUB_STEP_SUMMARY") === true,
    "deployment output must be reported",
  )
  require(
    requiredActions.every((action) =>
      uses.some((value) => new RegExp(`^${action}@[0-9a-f]{40}$`).test(value)),
    ),
    "all required actions must be pinned to commits",
  )
  require(!/release_please|release\.yml|tag_name/i.test(workflowSource), "workflow must not depend on releases")
  require(!/secrets\.|google.analytics|segment|posthog|plausible|beacon/i.test(workflowSource), "workflow must not use secrets or behavioral tracking")

  return issues
}
