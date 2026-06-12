# End-to-end Agent Run behavior regression coverage

Labels: ready-for-agent

## Parent

Paseo Agent Runs PRD: `thoughts/shared/prd/paseo-agent-runs-prd.md`

## What to build

Add focused regression coverage for the completed Paseo-backed Agent Run behavior. The tests should exercise the highest stable seams and verify user-visible behavior rather than private implementation details.

The suite should protect provider filtering, prompt construction, start and finish Comment formatting, pushed Comment refresh, and visible failure behavior.

## Acceptance criteria

- [ ] Tests cover provider filtering from representative `paseo provider ls --json` output.
- [ ] Tests cover prompt construction with `/goal`, `Requirement title`, Subtasks, and human-written Comments.
- [ ] Tests prove Description is excluded from the Agent Run Requirement Context.
- [ ] Tests prove prior Agent Run Comments are excluded from the Agent Run Requirement Context.
- [ ] Tests cover start Comment formatting with Paseo agent id, logs command, and attach command.
- [ ] Tests cover finish Comment formatting for success and failure.
- [ ] Tests cover pushed Comment refresh in the open Card details panel.
- [ ] Tests cover missing Paseo, daemon unavailable, no providers, invalid repository path, malformed JSON, and run start failure.
- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm build` pass after the coverage is added.

## Blocked by

- `001-dynamic-paseo-agent-provider-dropdown.md`
- `002-start-paseo-agent-run-from-card.md`
- `003-push-card-comment-changes-from-main-to-renderer.md`
- `004-append-finish-comment-when-paseo-agent-run-ends.md`
- `005-paseo-failure-states-are-visible-and-actionable.md`
- `006-remove-kanban-owned-agent-execution-lifecycle.md`
