/**
 * Test helpers for driving a React tree mounted on an OpenTUI test renderer.
 *
 * Two things need care in this environment. React refuses to flush updates outside
 * `act()` unless `IS_REACT_ACT_ENVIRONMENT` is set, and destroying a renderer that
 * still has a mounted root triggers unmount work that must be flushed the same way.
 * Both are wrapped here so no test has to remember.
 */

import { type CliRenderer } from "@opentui/core"
import { act } from "react"

/** Run a callback with React's act environment enabled, restoring the flag after. */
export async function withActEnvironment(fn: () => Promise<void>): Promise<void> {
  const globalWithFlag = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = globalWithFlag.IS_REACT_ACT_ENVIRONMENT
  globalWithFlag.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await fn()
  } finally {
    globalWithFlag.IS_REACT_ACT_ENVIRONMENT = previous
  }
}

/** Run `fn` inside `act()`, flushing every React update it schedules. */
export async function actAsync(fn: () => void | Promise<void>): Promise<void> {
  await withActEnvironment(async () => {
    await act(async () => {
      await fn()
    })
  })
}

/**
 * How long OpenTUI's stdin parser holds a lone `ESC` byte before deciding it is not
 * the prefix of a longer escape sequence (its `DEFAULT_TIMEOUT_MS` is 20ms). A test
 * that presses Escape must outwait that, since frame passes alone can spin faster.
 */
export const ESCAPE_DISAMBIGUATION_MS = 40

/** Yield to the event loop for `ms` of real time. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Destroy a renderer that has a mounted React root, flushing teardown inside act. */
export async function destroyMounted(renderer: CliRenderer): Promise<void> {
  await actAsync(() => {
    renderer.destroy()
  })
}
