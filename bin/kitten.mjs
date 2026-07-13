#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

import { runLauncher } from "./launcher.mjs"

const require = createRequire(import.meta.url)

process.exitCode = runLauncher({
  platform: process.platform,
  arch: process.arch,
  argv: process.argv.slice(2),
  resolve: (specifier) => require.resolve(specifier),
  spawn: spawnSync,
  reportError: (message) => console.error(message),
})
