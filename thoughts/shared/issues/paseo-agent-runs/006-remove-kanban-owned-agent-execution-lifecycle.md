# Remove Kanban-owned agent execution lifecycle

Labels: ready-for-agent

## Parent

Paseo Agent Runs PRD: `thoughts/shared/prd/paseo-agent-runs-prd.md`

## What to build

Remove the previous Kanban-owned execution lifecycle now that Paseo owns Agent Run execution. Kanban should no longer detect Codex or Pi binaries directly, shell out to provider-specific CLIs, create Git worktrees, create branch names, or write local agent log files.

The user-facing Agent Run flow should remain intact through the Paseo-backed provider discovery, start Comment, finish Comment, and push refresh paths.

## Acceptance criteria

- [ ] No production path shells out directly to Codex.
- [ ] No production path shells out directly to Pi.
- [ ] No production path creates a Git worktree for Agent Runs.
- [ ] No production path creates Agent Run branch names.
- [ ] No production path writes `.kanban-agent.log`.
- [ ] The Agent Run UI still supports provider selection, repository validation, and Run.
- [ ] The Agent Run service boundary is focused on Paseo orchestration and Card Comment writeback.
- [ ] Tests are updated to assert Paseo behavior instead of deleted Codex/Pi/worktree behavior.

## Blocked by

- `002-start-paseo-agent-run-from-card.md`
- `004-append-finish-comment-when-paseo-agent-run-ends.md`
