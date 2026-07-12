/**
 * The React seam over the session controller and its store.
 *
 * ADR-004 keeps all mutable state in an external store and asks React to subscribe
 * narrowly, so a token streaming into one agent's transcript cannot re-render the
 * other agent's status. `useAppSelector` is that subscription: it wires
 * `AppStore.subscribeSelector` into `useSyncExternalStore`, so React only wakes the
 * components whose exact slice changed - not every subscriber on every event.
 *
 * The controller is the sole channel to the agents (ADR-003). Views read state
 * through selectors and write intent through `controller.actions`; nothing here
 * exposes an `AgentConnection`.
 */

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react"

import type { SessionController, ShellRuntimeState } from "../app/controller.ts"
import type { ShellBufferType } from "../shell/shellRuntime.ts"
import type { Selector } from "../store/appStore.ts"

const ControllerContext = createContext<SessionController | null>(null)

/** Props for {@link CockpitProvider}. */
export interface CockpitProviderProps {
  controller: SessionController
  children: ReactNode
}

/** Make one controller (and its store) available to the whole cockpit tree. */
export function CockpitProvider({ controller, children }: CockpitProviderProps): ReactNode {
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>
}

/** The controller for the surrounding cockpit. Throws outside a {@link CockpitProvider}. */
export function useController(): SessionController {
  const controller = useContext(ControllerContext)
  if (!controller) throw new Error("useController must be used inside a <CockpitProvider>")
  return controller
}

/** The controller-owned shell runtime, including its fail-soft unavailable state. */
export function useShellRuntime(): ShellRuntimeState {
  return useController().shell
}

/** Subscribe narrowly to primary/alternate buffer activation in the imperative runtime. */
export function useShellBufferType(): ShellBufferType {
  const shell = useShellRuntime()
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      shell.ready ? shell.runtime.onBufferChange(() => onStoreChange()) : () => {},
    [shell],
  )
  const getSnapshot = useCallback(
    (): ShellBufferType => (shell.ready ? shell.runtime.bufferType() : "normal"),
    [shell],
  )

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Read one narrow slice of application state and re-render only when it changes.
 *
 * `selector` must be referentially stable across renders: an inline arrow (or an
 * un-memoized curried selector such as `selectSessionStatus(id)`) re-subscribes on
 * every render. Hoist module-level selectors, and wrap per-agent ones in `useMemo`.
 */
export function useAppSelector<T>(selector: Selector<T>, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const { store } = useController()

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeSelector(selector, onStoreChange, isEqual),
    [store, selector, isEqual],
  )
  const getSnapshot = useCallback(() => selector(store.getState()), [store, selector])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
