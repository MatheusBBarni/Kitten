#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { runLauncher } from "./launcher.mjs"

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

process.exitCode = runLauncher({
  platform: process.platform,
  arch: process.arch,
  argv: process.argv.slice(2),
  packageRoot,
  resolve: (specifier) => require.resolve(specifier),
  canonicalize: realpathSync,
  readManifest: (root) => JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
  spawn: spawnSync,
  reportOutput: (message) => console.log(message),
  reportError: (message) => console.error(message),
})
