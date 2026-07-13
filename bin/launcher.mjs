export const RELEASE_URL = "https://github.com/MatheusBBarni/Kitten/releases"

const SUPPORTED_PLATFORMS = new Set(["darwin", "linux"])
const SUPPORTED_ARCHES = new Set(["arm64", "x64"])

/** Return the npm platform-package slug for a supported Node host. */
export function platformSlug(platform, arch) {
  if (!SUPPORTED_PLATFORMS.has(platform) || !SUPPORTED_ARCHES.has(arch)) return null
  return `${platform}-${arch}`
}

/** Return the resolvable binary subpath inside a platform package. */
export function platformBinarySpecifier(slug) {
  return `@kitten/${slug}/kitten-${slug}`
}

/**
 * Resolve and synchronously run the host binary.
 *
 * Node-specific operations are injected by `kitten.mjs`, leaving this control flow
 * deterministic and directly testable.
 */
export function runLauncher({ platform, arch, argv, resolve, spawn, reportError }) {
  const slug = platformSlug(platform, arch)
  if (!slug) return fail(`unsupported platform ${platform}-${arch}`, reportError)

  const specifier = platformBinarySpecifier(slug)
  let binary
  try {
    binary = resolve(specifier)
  } catch {
    return fail(`no prebuilt binary for ${slug}`, reportError)
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

function fail(message, reportError) {
  reportError(`kitten: ${message}; download a standalone binary from ${RELEASE_URL}`)
  return 1
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
