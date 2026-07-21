import { dirname, isAbsolute, relative } from "node:path"

export const RELEASE_URL = "https://github.com/MatheusBBarni/Kitten/releases"
export const NPM_PACKAGE_NAME = "@matheusbbarni/kitten"
export const NPM_UPDATE_SPECIFIER = `${NPM_PACKAGE_NAME}@latest`
export const NPM_RECOVERY_COMMAND = `npm install --global ${NPM_UPDATE_SPECIFIER}`
export const STANDALONE_RECOVERY_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash"

const SUPPORTED_PLATFORMS = new Set(["darwin", "linux"])
const SUPPORTED_ARCHES = new Set(["arm64", "x64"])

/** Return the npm platform-package slug for a supported Node host. */
export function platformSlug(platform, arch) {
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHES.has(arch)) return null
  return `${platform}-${arch}`
}

/** Return the resolvable binary subpath inside a platform package. */
export function platformBinarySpecifier(slug) {
  return `${NPM_PACKAGE_NAME}-${slug}/kitten-${slug}`
}

/**
 * Resolve and synchronously run the host binary.
 *
 * Node-specific operations are injected by `kitten.mjs`, leaving this control flow
 * deterministic and directly testable.
 */
export function runLauncher({
  platform,
  arch,
  argv,
  packageRoot,
  resolve,
  canonicalize,
  readManifest,
  spawn,
  reportOutput,
  reportError,
}) {
  const forwardsMetadata = argv.includes("--version") || argv.includes("--help")
  const updates = !forwardsMetadata && argv.includes("--update")
  const slug = platformSlug(platform, arch)
  if (!slug) {
    return updates
      ? refuseUpdate(`the host platform ${platform}-${arch} is not supported`, reportError)
      : fail(`unsupported platform ${platform}-${arch}`, reportError)
  }

  const specifier = platformBinarySpecifier(slug)
  let binary
  try {
    binary = resolve(specifier)
  } catch {
    return updates
      ? refuseUpdate(`the ${slug} platform package could not be resolved safely`, reportError)
      : fail(`no prebuilt binary for ${slug}`, reportError)
  }

  if (updates) {
    return runNpmUpdate({
      slug,
      binary,
      packageRoot,
      resolve,
      canonicalize,
      readManifest,
      spawn,
      reportOutput,
      reportError,
    })
  }

  let result
  try {
    result = spawn(binary, argv, { stdio: "inherit" })
  } catch (error) {
    return fail(`failed to launch ${slug}: ${errorMessage(error)}`, reportError)
  }
  if (result.error) {
    return fail(`failed to launch ${slug}: ${errorMessage(result.error)}`, reportError)
  }

  return result.status ?? 1
}

function runNpmUpdate({
  slug,
  binary,
  packageRoot,
  resolve,
  canonicalize,
  readManifest,
  spawn,
  reportOutput,
  reportError,
}) {
  if (
    typeof packageRoot !== "string" ||
    typeof canonicalize !== "function" ||
    typeof readManifest !== "function" ||
    typeof reportOutput !== "function"
  ) {
    return refuseUpdate("npm installation ownership could not be inspected safely", reportError)
  }

  let canonicalMainRoot
  let canonicalBinary
  let canonicalPlatformRoot
  try {
    canonicalMainRoot = canonicalize(packageRoot)
    canonicalBinary = canonicalize(binary)
    canonicalPlatformRoot = canonicalize(dirname(canonicalBinary))
  } catch {
    return refuseUpdate("the npm package paths could not be canonicalized safely", reportError)
  }

  const rootResult = runCommand(spawn, "npm", ["root", "--global"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (!rootResult.ok) {
    return refuseUpdate("the npm global package root could not be resolved safely", reportError)
  }

  const npmRoot = parseSolePath(rootResult.result.stdout)
  if (!npmRoot) {
    return refuseUpdate("npm returned an invalid global package root", reportError)
  }

  let canonicalGlobalRoot
  try {
    canonicalGlobalRoot = canonicalize(npmRoot)
  } catch {
    return refuseUpdate("the npm global package root could not be canonicalized safely", reportError)
  }

  if (!isPathDescendant(canonicalGlobalRoot, canonicalMainRoot)) {
    return refuseUpdate("the running Kitten package is not owned by global npm", reportError)
  }
  if (
    !isPathDescendant(canonicalGlobalRoot, canonicalBinary) ||
    !isPathDescendant(canonicalGlobalRoot, canonicalPlatformRoot)
  ) {
    return refuseUpdate("the resolved platform package is not owned by the same global npm root", reportError)
  }

  let mainManifest
  let platformManifest
  try {
    mainManifest = readManifest(canonicalMainRoot)
    platformManifest = readManifest(canonicalPlatformRoot)
  } catch {
    return refuseUpdate("the verified npm package manifests could not be read safely", reportError)
  }

  const expectedPlatformPackage = `${NPM_PACKAGE_NAME}-${slug}`
  if (!isPackageManifest(mainManifest, NPM_PACKAGE_NAME)) {
    return refuseUpdate("the main npm package manifest does not match Kitten", reportError)
  }
  if (!isPackageManifest(platformManifest, expectedPlatformPackage)) {
    return refuseUpdate("the platform npm package manifest does not match the resolved binary", reportError)
  }
  if (platformManifest.version !== mainManifest.version) {
    return refuseUpdate("the main and platform npm package versions do not match", reportError)
  }

  const priorVersion = mainManifest.version
  const installResult = runCommand(spawn, "npm", ["install", "--global", NPM_UPDATE_SPECIFIER], {
    stdio: "inherit",
  })
  if (!installResult.ok) {
    return failUpdate("the npm update transaction failed", reportError)
  }

  let resultManifest
  try {
    resultManifest = readManifest(canonicalMainRoot)
  } catch {
    return failUpdate("the updated npm package version could not be read safely", reportError)
  }
  if (!isPackageManifest(resultManifest, NPM_PACKAGE_NAME)) {
    return failUpdate("the updated npm package manifest does not match Kitten", reportError)
  }

  let resultBinary
  let canonicalResultBinary
  let resultPlatformRoot
  let resultPlatformManifest
  try {
    resultBinary = resolve(platformBinarySpecifier(slug))
    canonicalResultBinary = canonicalize(resultBinary)
    resultPlatformRoot = canonicalize(dirname(canonicalResultBinary))
    resultPlatformManifest = readManifest(resultPlatformRoot)
  } catch {
    return failUpdate("the updated npm platform package could not be resolved safely", reportError)
  }
  if (
    !isPathDescendant(canonicalGlobalRoot, canonicalResultBinary) ||
    !isPathDescendant(canonicalGlobalRoot, resultPlatformRoot)
  ) {
    return failUpdate("the updated npm platform package is not owned by the same global npm root", reportError)
  }
  if (!isPackageManifest(resultPlatformManifest, expectedPlatformPackage)) {
    return failUpdate("the updated npm platform package manifest does not match the resolved binary", reportError)
  }
  if (resultPlatformManifest.version !== resultManifest.version) {
    return failUpdate("the updated main and platform npm package versions do not match", reportError)
  }

  if (resultManifest.version === priorVersion) {
    reportOutput(`Kitten is already current via npm at version ${priorVersion}.\nNo change occurred.`)
  } else {
    reportOutput(`Kitten updated via npm: ${priorVersion} -> ${resultManifest.version}.`)
  }
  return 0
}

function runCommand(spawn, command, argv, options) {
  let result
  try {
    result = spawn(command, argv, options)
  } catch {
    return { ok: false }
  }
  if (result?.error || result?.status !== 0) return { ok: false }
  return { ok: true, result }
}

function parseSolePath(stdout) {
  const output = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : stdout
  if (typeof output !== "string" || output.includes("\0")) return null
  const lines = output.split(/\r?\n/)
  if (lines.at(-1) === "") lines.pop()
  if (lines.length !== 1 || lines[0] === "" || lines[0] !== lines[0].trim()) return null
  return isAbsolute(lines[0]) ? lines[0] : null
}

function isPathDescendant(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${pathSeparator(pathFromRoot)}`) && !isAbsolute(pathFromRoot)
}

function pathSeparator(path) {
  return path.includes("\\") ? "\\" : "/"
}

function isPackageManifest(manifest, expectedName) {
  return (
    manifest !== null &&
    typeof manifest === "object" &&
    manifest.name === expectedName &&
    typeof manifest.version === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)
  )
}

function fail(message, reportError) {
  reportError(`kitten: ${message}; download a standalone binary from ${RELEASE_URL}`)
  return 1
}

function refuseUpdate(message, reportError) {
  reportError(formatNoChangeOutcome("refused", message))
  return 1
}

function failUpdate(message, reportError) {
  reportError(formatNoChangeOutcome("failed", message))
  return 1
}

function formatNoChangeOutcome(kind, message) {
  return [
    `Kitten update ${kind}: ${message}`,
    "No change occurred.",
    "Supported recovery commands:",
    NPM_RECOVERY_COMMAND,
    STANDALONE_RECOVERY_COMMAND,
  ].join("\n")
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
