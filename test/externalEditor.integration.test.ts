import { expect, test } from "bun:test"

import {
  createExternalEditorLauncher,
  type ExternalEditorSpawnOptions,
  type OpenableFile,
} from "../src/app/externalEditor.ts"

test("a prevalidated file reaches the launcher without repository discovery", async () => {
  const file = {
    kind: "openable-file",
    absolutePath: "/workspace/.hidden/review.ts",
  } as const satisfies OpenableFile
  const calls: ExternalEditorSpawnOptions[] = []
  const launcher = createExternalEditorLauncher({
    platform: "linux",
    spawn(options) {
      calls.push(options)
      return { exited: Promise.resolve(0) }
    },
  })

  await expect(
    launcher.launch(file, {
      kind: "custom",
      executable: "editor-bin",
      args: ["--line", "1", "{file}"],
    }),
  ).resolves.toEqual({ kind: "custom-dispatched" })
  expect(calls.map((call) => call.cmd)).toEqual([
    ["editor-bin", "--line", "1", file.absolutePath],
  ])
  expect(calls.some((call) => call.cmd[0] === "git")).toBe(false)
})
