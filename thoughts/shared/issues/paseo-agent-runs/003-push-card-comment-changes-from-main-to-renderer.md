# Push Card Comment changes from main to renderer

Labels: ready-for-agent

## Parent

Paseo Agent Runs PRD: `thoughts/shared/prd/paseo-agent-runs-prd.md`

## What to build

Add a reusable main-process push event for Card Comment changes and make the renderer update the currently open Card when a relevant Comment is added by the main process. This makes Agent Run start and finish Comments appear without closing and reopening the Card.

This should follow ADR 0005: use push events rather than renderer polling.

## Acceptance criteria

- [ ] The main process emits a Card or Card Comment change event whenever it adds a Comment.
- [ ] The preload API exposes a typed subscription for this push event.
- [ ] The renderer subscribes to the event and refreshes or patches the current Board/Card state when the changed Card is visible.
- [ ] The renderer ignores events for unrelated Cards or Boards.
- [ ] The subscription is cleaned up when the renderer component unmounts.
- [ ] Tests cover receiving a pushed Comment change while the Card details panel is open.
- [ ] Tests cover that unrelated Card events do not disturb the current Card details view.

## Blocked by

None - can start immediately
