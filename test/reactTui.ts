/**
 * Test helpers for driving a React tree mounted on an OpenTUI test renderer.
 *
 * Two things need care in this environment. React refuses to flush updates outside
 * `act()` unless `IS_REACT_ACT_ENVIRONMENT` is set, and destroying a renderer that
 * still has a mounted root triggers unmount work that must be flushed the same way.
 * Both are wrapped here so no test has to remember.
 */

import { CodeRenderable, destroyTreeSitterClient, type BaseRenderable, type CliRenderer } from "@opentui/core"
import { createTestRenderer, type TestRendererOptions, type TestRendererSetup } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { act, type ReactNode } from "react"

const mountedRoots = new WeakMap<CliRenderer, ReturnType<typeof createRoot>>()

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
 * Render a React tree with its root registered for explicit teardown.
 *
 * OpenTUI's bundled `testRender` unmounts the root from the renderer's destroy
 * callback. That is too late for code leaves: renderer destruction has already
 * disposed the shared Tree-sitter client. Keeping the root here lets
 * `destroyMounted` unmount it while the renderer is still usable.
 */
export async function testRender(node: ReactNode, options: TestRendererOptions): Promise<TestRendererSetup> {
  const setup = await createTestRenderer(options)
  const root = createRoot(setup.renderer)
  mountedRoots.set(setup.renderer, root)
  await actAsync(() => {
    root.render(node)
  })
  return setup
}

/**
 * How long OpenTUI's stdin parser holds a lone `ESC` byte before deciding it is not
 * the prefix of a longer escape sequence (its `DEFAULT_TIMEOUT_MS` is 20ms). A test
 * that presses Escape must outwait that, since frame passes alone can spin faster.
 */
export const ESCAPE_DISAMBIGUATION_MS = 40

/** Time for a detached code leaf's debounced highlighter to finish before teardown. */
const HIGHLIGHT_TEARDOWN_SETTLE_MS = 100

/** Yield to the event loop for `ms` of real time. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function collectCodeRenderables(root: BaseRenderable): CodeRenderable[] {
  const codes = root instanceof CodeRenderable ? [root] : []
  for (const child of root.getChildren()) {
    codes.push(...collectCodeRenderables(child))
  }
  return codes
}

/** Wait for syntax work owned by code leaves that are still mounted. */
export async function settleMountedHighlights(renderer: CliRenderer): Promise<void> {
  await Promise.all(collectCodeRenderables(renderer.root).map((code) => code.highlightingDone))
}

/** Destroy a renderer that has a mounted React root, flushing teardown inside act. */
export async function destroyMounted(renderer: CliRenderer): Promise<void> {
  if (renderer.isDestroyed) return
  const root = mountedRoots.get(renderer)
  // OpenTUI tears down its shared Tree-sitter client before React unmounts the root.
  // Let a just-committed React update reach the native tree, then await in-flight
  // syntax work and its follow-up paint. Otherwise an overlay removed by the last
  // input event can leave a Markdown leaf resuming against the destroyed client.
  await renderer.idle()
  if (root) {
    await actAsync(async () => {
      await sleep(HIGHLIGHT_TEARDOWN_SETTLE_MS)
    })
    await renderer.idle()
  }
  await settleMountedHighlights(renderer)
  await renderer.idle()
  if (root) {
    await actAsync(() => {
      root.unmount()
    })
    mountedRoots.delete(renderer)
    await renderer.idle()
    await settleMountedHighlights(renderer)
    await renderer.idle()
  }
  // `renderer.destroy()` starts global Tree-sitter cleanup only after it has removed
  // the last renderer, and intentionally does not await that work. Finish it while
  // this empty renderer is still tracked so the next test cannot adopt a client that
  // is concurrently being torn down on slower native runners.
  await destroyTreeSitterClient()
  await actAsync(() => {
    renderer.destroy()
  })
}
