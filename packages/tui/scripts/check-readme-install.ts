const CANONICAL_REPO = "MatheusBBarni/Kitten"
const INSTALL_URL_PATTERN = /https:\/\/raw\.githubusercontent\.com\/([^/\s]+\/[^/\s]+)\/main\/scripts\/install\.sh/

export interface ResolvedInstallContract {
  repo: string
  repoUrl: string
  installUrl: string
}

export type ResolveUrl = (url: string) => Promise<{ ok: boolean; status: number }>

export function readInstallContract(readme: string): ResolvedInstallContract {
  if (readme.includes("OWNER/")) {
    throw new Error("README install commands must not contain the OWNER/ placeholder")
  }

  const match = readme.match(INSTALL_URL_PATTERN)
  if (!match?.[1]) {
    throw new Error("README must document the raw GitHub install.sh URL")
  }

  const repo = match[1]
  if (repo !== CANONICAL_REPO) {
    throw new Error(`README installer must use ${CANONICAL_REPO}, found ${repo}`)
  }

  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    installUrl: match[0],
  }
}

export async function checkReadmeInstall(
  readme: string,
  resolve: ResolveUrl = (url) => fetch(url, { redirect: "follow" }),
): Promise<ResolvedInstallContract> {
  const contract = readInstallContract(readme)

  for (const url of [contract.repoUrl, contract.installUrl]) {
    let response: Awaited<ReturnType<ResolveUrl>>
    try {
      response = await resolve(url)
    } catch (error) {
      throw new Error(`README install URL did not resolve: ${url}: ${String(error)}`)
    }
    if (!response.ok) {
      throw new Error(`README install URL returned HTTP ${response.status}: ${url}`)
    }
  }

  return contract
}

if (import.meta.main) {
  const path = process.argv[2] ?? "README.md"
  const readme = await Bun.file(path).text()
  const contract = await checkReadmeInstall(readme)
  console.log(`README install channel resolves: ${contract.repo} (${contract.installUrl})`)
}
