# Defer blocked recurrence recovery UI

Blocked Recurrence Series remain visible through the existing recurrence badge, recurrence summary, and recurrence popover warning, but we are not adding a dedicated recovery flow yet. We chose this because the current blocked state already tells the board owner what prevented generation, while a repair flow for restoring or changing the Completion Column would need a broader board-settings interaction model that does not exist yet.

## Considered Options

- Defer recovery UI: preserves visibility through existing card recurrence surfaces and keeps the recurrence model internal.
- Add a minimal repair path now: could help users recover faster, but would introduce board-level column repair controls before that area has a clear interaction design.
- Hide blocked state until recovery exists: simpler UI, but leaves users without feedback when completion-trigger generation cannot proceed.

## Consequences

- Blocked recurrence remains an observable state on the active Recurrence Baton card.
- Existing recurrence controls may show the blocked reason, but they do not repair board configuration directly.
- A future repair path should define how a board owner restores the archived Completion Column or selects a new active Completion Column before implementation.
- Repository and UI tests must keep blocked recurrence behavior visible even while recovery UI is deferred.