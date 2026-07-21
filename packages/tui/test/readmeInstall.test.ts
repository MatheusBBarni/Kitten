import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { checkReadmeInstall, readInstallContract, type ResolveUrl } from "../../../scripts/check-readme-install.ts"

const README = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")

const REAL_README = `
# Kitten

\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash
\`\`\`
`

describe("README install contract", () => {
  it("extracts the canonical repository and installer URL", () => {
    expect(readInstallContract(REAL_README)).toEqual({
      repo: "MatheusBBarni/Kitten",
      repoUrl: "https://github.com/MatheusBBarni/Kitten",
      installUrl: "https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh",
    })
  })

  it("keeps the real README on the canonical raw installer contract without resolving the network", () => {
    expect(readInstallContract(README)).toEqual({
      repo: "MatheusBBarni/Kitten",
      repoUrl: "https://github.com/MatheusBBarni/Kitten",
      installUrl: "https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh",
    })
    expect(README).toContain(
      "curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash",
    )
  })

  it("rejects the OWNER placeholder before resolving URLs", async () => {
    let calls = 0
    const resolve: ResolveUrl = async () => {
      calls += 1
      return { ok: true, status: 200 }
    }

    await expect(
      checkReadmeInstall(
        "curl -fsSL https://raw.githubusercontent.com/OWNER/kitten/main/scripts/install.sh | bash",
        resolve,
      ),
    ).rejects.toThrow("OWNER/ placeholder")
    expect(calls).toBe(0)
  })

  it("rejects a missing installer URL", () => {
    expect(() => readInstallContract("# Kitten")).toThrow("must document the raw GitHub install.sh URL")
  })

  it("rejects a non-canonical repository slug", () => {
    expect(() =>
      readInstallContract(
        "curl -fsSL https://raw.githubusercontent.com/example/Kitten/main/scripts/install.sh | bash",
      ),
    ).toThrow("must use MatheusBBarni/Kitten")
  })

  it("passes when the canonical repository and installer both resolve", async () => {
    const requested: string[] = []
    const contract = await checkReadmeInstall(REAL_README, async (url) => {
      requested.push(url)
      return { ok: true, status: 200 }
    })

    expect(contract.repo).toBe("MatheusBBarni/Kitten")
    expect(requested).toEqual([contract.repoUrl, contract.installUrl])
  })

  it("uses fetch as the default URL resolver", async () => {
    const originalFetch = globalThis.fetch
    const requested: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
      requested.push(String(input))
      return new Response("ok", { status: 200 })
    }) as typeof fetch

    try {
      const contract = await checkReadmeInstall(REAL_README)
      expect(requested).toEqual([contract.repoUrl, contract.installUrl])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("fails when the documented installer returns 404", async () => {
    await expect(
      checkReadmeInstall(REAL_README, async (url) => ({
        ok: !url.includes("raw.githubusercontent.com"),
        status: url.includes("raw.githubusercontent.com") ? 404 : 200,
      })),
    ).rejects.toThrow("returned HTTP 404")
  })

  it("fails when URL resolution throws", async () => {
    await expect(
      checkReadmeInstall(REAL_README, async () => {
        throw new Error("offline")
      }),
    ).rejects.toThrow("did not resolve")
  })
})
