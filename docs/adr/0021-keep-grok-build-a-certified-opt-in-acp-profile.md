# Keep Grok Build a certified opt-in ACP profile

## Status

Accepted

## Decision

Kitten recognizes `grok-build` as a first-class Direct ACP Route, but opens its certified profile only when an operator explicitly configures an exact reviewed npx package release. Grok Build retains ownership of authentication, credentials, session storage, and provider data policy; Kitten preserves its shared human approval flow, documents that boundary, and admits only baseline ACP behavior until each advanced capability has separate credentialed evidence. A user-modified recipe may run only as generic ACP, with no profile-specific certification or capability claim.

## Considered Options

- Launch Grok Build by default with the other built-in providers. This would expose a fast-moving, externally authenticated provider in every zero-config cockpit.
- Require every Grok recipe to be the certified profile. This would preserve a narrow support contract but unnecessarily prevent an advanced user from trying generic ACP behavior.
- Start Grok Build with auto-approval or have Kitten manage its credentials and privacy settings. Both choices would bypass Kitten's existing consent boundary or give it authority over provider-owned state.

## Consequences

- The initial profile uses an exact `@xai-official/grok` npx release admitted only after credentialed contract evidence; upgrades require new reviewed evidence. A modified recipe can start only under the existing generic ACP contract and must not claim profile-specific support.
- Baseline certification covers the standard ACP lifecycle, restore, streaming, shared MCP setup, ordinary handoff, and Kitten approval choices. Structured clarification, native steering, harness delivery, and delegation remain unavailable until separately certified.
- Documentation must make the required prior authentication and Grok Build's provider-owned network and local-session behavior explicit, without persisting credentials or changing `~/.grok` policy.
- Certification evidence is required on every Kitten release platform before the profile is presented as cross-platform supported; unverified platforms remain unavailable.
