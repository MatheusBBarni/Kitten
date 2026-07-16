# Keep sealed Context Packs portable and revalidate every recipient

A Context Pack may be consumed by its parent, a delegated child, or a different provider through hand-off, but those recipients can have different context capacity and tokenization. Kitten will keep a **Sealed Context Pack** provider-neutral and immutable under its declared **Pack Budget**, then perform a fresh **Recipient Fit Check** immediately before each send. Curation shows exact serialized bytes plus a clearly labeled provider-neutral **Pack Estimate**; the fit check requires a certified provider-specific **Recipient Count** or conservative upper bound plus sufficient capacity evidence. Existing sessions use live reported headroom. A prospective child uses a closed, versioned **Recipient Profile** tied to its exact provider/model recipe, usable fresh-session capacity, counter version, and reserved headroom. Missing or stale accounting makes fit unavailable, while an insufficient count blocks the send and requires a new draft and review. Kitten never treats an estimate as proof or trims, substitutes, or partially sends reviewed material.

## Considered Options

- Bind the pack to one recipient and model before curation.
- Treat size as advisory and allow oversized sends.
- Keep the exact payload portable and gate each destination independently.

## Consequences

- Recipient-specific capacity and tokenization are validation facts, not part of Context Pack identity.
- Every parent-send, child-start, and cross-agent hand-off path must use the same fit gate.
- Reusing a pack across providers remains possible without weakening the explicit-review guarantee.
- ACP runtime usage can supply live headroom but does not supply a standard pre-send tokenizer, so recipient counters require their own closed certification boundary.
- Starting a fresh child is denied before reservation or spawn when its exact Recipient Profile is absent or stale.
