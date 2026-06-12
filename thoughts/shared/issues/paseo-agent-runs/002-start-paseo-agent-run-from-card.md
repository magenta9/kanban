# Start a Paseo Agent Run from a Card

Labels: ready-for-agent

## Parent

Paseo Agent Runs PRD: `thoughts/shared/prd/paseo-agent-runs-prd.md`

## What to build

Let a user start an Agent Run from the Card details panel using a selected Paseo Agent Provider and Git repository path. Kanban should validate the repository path, build the Agent Run Requirement Context prompt, call Paseo in detached mode with JSON output, and append a start Comment to the Card once Paseo accepts the run.

The prompt must contain requirement context only: `/goal`, the Card Title as `Requirement title`, Subtasks, and human-written Comments. It must exclude Description, prior Agent Run Comments, repository path, branch, worktree, provider metadata, Paseo agent id, logs, and attach commands.

## Acceptance criteria

- [ ] Run validates the selected repository path before invoking Paseo.
- [ ] Run invokes Paseo with detached JSON execution, the selected provider id, the selected repository as working directory, and a Paseo-managed worktree option.
- [ ] Kanban does not create the worktree or branch itself in this start path.
- [ ] The generated prompt starts with `/goal`.
- [ ] The generated prompt labels the Card Title as `Requirement title`.
- [ ] The generated prompt includes Subtasks.
- [ ] The generated prompt includes only human-written Comments.
- [ ] The generated prompt excludes Description and prior Agent Run Comments.
- [ ] A start Comment is appended after Paseo returns a run id.
- [ ] The start Comment includes Agent Provider label, Paseo agent id, `paseo logs <id>`, and `paseo attach <id>`.
- [ ] Prompt construction and start Comment formatting are covered by tests.

## Blocked by

- `001-dynamic-paseo-agent-provider-dropdown.md`
