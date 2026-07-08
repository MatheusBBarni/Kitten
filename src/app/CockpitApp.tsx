/**
 * Placeholder cockpit frame for the scaffold.
 *
 * This renders a minimal, static shell so the OpenTUI + React bootstrap is
 * proven end to end (task_01). The real cockpit - StatusStrip, ConversationView,
 * PromptEditor, and the hand-off/approval overlays - is built in later tasks and
 * will replace this placeholder while keeping the same entry contract.
 */

/** Text shown as the cockpit title; asserted by the integration frame test. */
export const COCKPIT_TITLE = "Kitten"

/** Hint shown to the user for how to leave the app; also asserted in tests. */
export const EXIT_HINT = "Press Ctrl+C to exit"

export function CockpitApp() {
  return (
    <box
      style={{
        border: true,
        flexDirection: "column",
        padding: 1,
        gap: 1,
      }}
      title={COCKPIT_TITLE}
    >
      <text fg="#F5C542">Cross-Agent Hand-off Cockpit</text>
      <text fg="#888888">Scaffold ready. Agents and hand-off flow arrive in later tasks.</text>
      <text fg="#888888">{EXIT_HINT}</text>
    </box>
  )
}
