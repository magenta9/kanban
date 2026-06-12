# Append finish Comment when Paseo Agent Run ends

Labels: ready-for-agent

## Parent

Paseo Agent Runs PRD: `thoughts/shared/prd/paseo-agent-runs-prd.md`

## What to build

After a Paseo Agent Run starts, wait for the Paseo agent in a background main-process path and append one finish Comment when the run completes or fails. The finish Comment should connect back to the same Paseo agent id and provide an actionable summary plus the logs command.

This slice should rely on the push event path so the finish Comment appears in the open Card details panel without manual refresh.

## Acceptance criteria

- [ ] The main process waits for the Paseo agent after the detached start response.
- [ ] A successful run appends one finish Comment.
- [ ] A failed run appends one finish Comment.
- [ ] The finish Comment includes Agent Provider label, Paseo agent id, status, and `paseo logs <id>`.
- [ ] The finish Comment includes a concise summary derived from Paseo output, inspect output, or logs.
- [ ] The implementation does not stream progress into Comments.
- [ ] The implementation does not edit the start Comment.
- [ ] The open Card details panel receives the finish Comment through the push event path.
- [ ] Finish Comment behavior is covered by tests for completed and failed runs.

## Blocked by

- `002-start-paseo-agent-run-from-card.md`
- `003-push-card-comment-changes-from-main-to-renderer.md`
