# Paseo failure states are visible and actionable

Labels: ready-for-agent

## Parent

Paseo Agent Runs PRD: `thoughts/shared/prd/paseo-agent-runs-prd.md`

## What to build

Make Paseo-related failure states visible and actionable from the Agent panel and Card Comments. Users should understand when Paseo is missing, the daemon is unavailable, no providers are available, a repository path is invalid, Paseo JSON is malformed, or a run could not be started.

Where a Paseo Agent Run has already been attempted and a Card-level record is useful, write a failure finish Comment. Where the run cannot begin at all, show a clear UI error and keep Run disabled or failed without creating misleading execution Comments.

## Acceptance criteria

- [ ] Missing Paseo produces a clear Agent panel error.
- [ ] Paseo daemon unavailable produces a clear Agent panel error.
- [ ] No available providers disables Run and explains why.
- [ ] Invalid repository path disables or blocks Run with a clear validation message.
- [ ] Malformed provider JSON fails clearly and does not show stale provider options.
- [ ] Run start failure is visible to the user.
- [ ] If a run id exists before failure, the Card gets a failure finish Comment.
- [ ] Failure messages avoid raw stack traces where a user-facing message is available.
- [ ] Failure paths are covered by tests with mocked Paseo command results.

## Blocked by

- `001-dynamic-paseo-agent-provider-dropdown.md`
- `002-start-paseo-agent-run-from-card.md`
