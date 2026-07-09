import { describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The installer is exercised by sourcing it (its `BASH_SOURCE`/`$0` guard keeps
 * `main` from running on source) and calling its functions directly, so the
 * safety-critical checksum verification is tested without any network download.
 */
const INSTALLER = join(import.meta.dir, "..", "scripts", "install.sh")

/** Source the installer, then run `snippet` with `set -e` relaxed so `$?` survives. */
function inInstaller(snippet: string, env: Record<string, string> = {}): { stdout: string; exitCode: number } {
  const result = Bun.spawnSync(["bash", "-c", `source "${INSTALLER}"; set +e; ${snippet}`], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { stdout: result.stdout.toString(), exitCode: result.exitCode }
}

async function withTempFile(contents: string, run: (path: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kitten-install-"))
  try {
    const file = join(dir, "kitten-linux-x64")
    await writeFile(file, contents)
    await run(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe("install.sh verify_checksum", () => {
  it("succeeds when the checksum matches", async () => {
    await withTempFile("binary-bytes", (file) => {
      const expected = createHash("sha256").update("binary-bytes").digest("hex")
      const { stdout } = inInstaller(`verify_checksum "${file}" "${expected}"; echo "rc=$?"`)
      expect(stdout).toContain("rc=0")
    })
  })

  it("fails on a checksum mismatch and never installs", async () => {
    await withTempFile("binary-bytes", (file) => {
      const { stdout } = inInstaller(`verify_checksum "${file}" "deadbeef"; echo "rc=$?"`)
      expect(stdout).toContain("rc=1")
    })
  })

  it("fails when no expected checksum is supplied", async () => {
    await withTempFile("binary-bytes", (file) => {
      const { stdout } = inInstaller(`verify_checksum "${file}" ""; echo "rc=$?"`)
      expect(stdout).toContain("rc=1")
    })
  })

  it("fails when the file to verify is missing", () => {
    const { stdout } = inInstaller(`verify_checksum "/no/such/file" "deadbeef"; echo "rc=$?"`)
    expect(stdout).toContain("rc=1")
  })
})

describe("install.sh helpers", () => {
  it("extracts the checksum for a named artifact from the manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitten-manifest-"))
    try {
      const manifest = join(dir, "SHA256SUMS")
      await writeFile(manifest, "aaa  kitten-darwin-arm64\nbbb  kitten-linux-x64\n")
      const { stdout, exitCode } = inInstaller(`checksum_for "${manifest}" kitten-linux-x64`)
      expect(stdout.trim()).toBe("bbb")
      expect(exitCode).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("honors a KITTEN_PLATFORM override for detection", () => {
    const { stdout } = inInstaller(`detect_platform`, { KITTEN_PLATFORM: "linux-arm64" })
    expect(stdout.trim()).toBe("linux-arm64")
  })
})
