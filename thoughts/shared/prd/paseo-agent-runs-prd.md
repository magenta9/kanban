# Paseo Agent Runs PRD

## Problem Statement

Users want to launch an Agent Run from a Card without Kanban owning the execution mechanics of coding agents. The current implementation duplicates provider detection, worktree creation, branch management, background process execution, and log capture inside Kanban, which makes the app responsible for concerns that Paseo already owns.

Users also need Card Comments to update in real time when an Agent Run starts or finishes. Today, Comments created after the initial start response can be invisible until manual refresh because the renderer does not receive pushed Card change events from the main process.

## Solution

Kanban will delegate Agent Run execution to Paseo. Kanban will collect the Agent Run Requirement Context from the Card, ask Paseo for available Agent Providers, start a detached Paseo agent in a Paseo-managed worktree, and write start and finish Comments back to the Card.

The renderer will receive push events from the main process when Card Comments change, so the start Comment and finish Comment appear without manual refresh. Agent Run Comments will be append-only: one Comment when the Agent Run starts and one Comment when it finishes.

## User Stories

1. As a user, I want to start an Agent Run from a Card, so that the Card's requirement can be worked on by an external coding agent.
2. As a user, I want Kanban to use Paseo for Agent Runs, so that worktree, branch, provider, and log handling are consistent with my command-line workflow.
3. As a user, I want to choose from Paseo Agent Providers, so that I can run the provider currently available in my local Paseo setup.
4. As a user, I want the Agent Provider dropdown to be populated dynamically, so that Kanban reflects provider availability without hardcoded options.
5. As a user, I want unavailable Paseo providers hidden from the dropdown, so that I do not choose a provider that cannot run.
6. As a user, I want the dropdown label to use Paseo's provider label, so that provider names match the Paseo CLI.
7. As a user, I want Kanban to submit the provider id returned by Paseo, so that execution uses the correct Paseo provider.
8. As a user, I want to select a Git repository path, so that Paseo runs the Agent Run in the intended repository.
9. As a user, I want Kanban to validate the selected repository path, so that I get immediate feedback when the folder is not a Git repository.
10. As a user, I want Kanban to pass the selected path to Paseo as the working directory, so that Paseo creates the managed worktree from the right repository.
11. As a user, I want Paseo to create and manage the worktree, so that Kanban does not duplicate worktree lifecycle logic.
12. As a user, I want Paseo to manage the branch, so that Kanban does not create branch names or branch lifecycles itself.
13. As a user, I want Paseo to manage logs, so that I can use familiar `paseo logs` and `paseo attach` commands.
14. As a user, I want an Agent Run start Comment to appear as soon as Paseo starts the detached agent, so that I know the request was accepted.
15. As a user, I want the start Comment to include the Paseo agent id, so that I can find the run outside Kanban.
16. As a user, I want the start Comment to include `paseo logs <id>`, so that I can inspect the run from a terminal.
17. As a user, I want the start Comment to include `paseo attach <id>`, so that I can attach to the running agent.
18. As a user, I want a finish Comment when the Agent Run ends, so that the Card records the outcome.
19. As a user, I want the finish Comment to include whether the Agent Run completed or failed, so that I can decide what to do next.
20. As a user, I want the finish Comment to include a concise summary, so that I can understand the result without opening logs first.
21. As a user, I want the finish Comment to include the same Paseo agent id, so that start and finish Comments can be connected.
22. As a user, I want the finish Comment to include the logs command, so that I can inspect details after completion.
23. As a user, I want Comments to update in the Card details panel in real time, so that I do not need to close and reopen the Card.
24. As a user, I want Comment push updates to work for Agent Run start Comments, so that I immediately see the run was created.
25. As a user, I want Comment push updates to work for Agent Run finish Comments, so that I know when the agent has stopped.
26. As a user, I want Agent Run progress not to spam Comments, so that the Card's working context stays readable.
27. As a user, I want Agent Run Comments to be append-only, so that the Card history remains understandable.
28. As a user, I want the Agent Run prompt to start with `/goal`, so that the receiving agent handles the request through the intended command.
29. As a user, I want the prompt to use the Card Title as the requirement title, so that the agent focuses on the current requirement.
30. As a user, I want the prompt to include Subtasks, so that the agent sees the checklist of expected work.
31. As a user, I want the prompt to include human-written Comments, so that the agent sees the latest requirement discussion.
32. As a user, I want the prompt to exclude the Description, so that the Agent Run uses the agreed requirement context instead of the Card's general body.
33. As a user, I want the prompt to exclude prior Agent Run Comments, so that previous execution metadata does not pollute the new requirement.
34. As a user, I want the prompt to exclude repository paths, branches, worktrees, logs, and provider metadata, so that the agent receives requirement context rather than execution context.
35. As a maintainer, I want Kanban to stop detecting `codex` and `pi` binaries directly, so that provider availability is sourced from Paseo.
36. As a maintainer, I want Kanban to stop shelling out to provider-specific CLIs, so that provider-specific behavior stays behind Paseo.
37. As a maintainer, I want Kanban to stop creating Git worktrees itself, so that worktree behavior is not duplicated.
38. As a maintainer, I want Kanban to stop creating branch names for Agent Runs, so that branch policy is owned by Paseo.
39. As a maintainer, I want Kanban to stop writing local agent log files, so that logs are owned by Paseo.
40. As a maintainer, I want the Agent Run service to be responsible for Paseo orchestration only, so that the main process has a narrow boundary.
41. As a maintainer, I want the renderer to consume an IPC contract for Agent Providers, so that UI logic does not depend on CLI output shapes.
42. As a maintainer, I want Paseo JSON parsing to be validated, so that unexpected CLI output fails clearly.
43. As a maintainer, I want Card Comment push events to be a reusable mechanism, so that future main-process Comment writers can update the renderer.
44. As a maintainer, I want Comment updates to preserve the domain term Comment, so that Agent Run status is represented as Card working context.
45. As a maintainer, I want tests to exercise the Agent Run behavior through service and IPC seams, so that implementation details can change without rewriting tests.
46. As a maintainer, I want tests to cover provider filtering, so that disabled or unavailable Paseo providers are not shown.
47. As a maintainer, I want tests to cover prompt construction, so that Description and Agent Run Comments do not accidentally enter the Agent Run Requirement Context.
48. As a maintainer, I want tests to cover pushed Comment refresh, so that the renderer no longer depends on manual reload after background work.
49. As a maintainer, I want tests to cover Paseo start and finish Comment formatting, so that users always get actionable `paseo logs` and `paseo attach` commands.
50. As a maintainer, I want failures from Paseo startup to produce a visible finish Comment, so that Agent Run failures are not silent.

## Implementation Decisions

- Delegate Agent Run provider discovery, detached execution, worktree creation, branch management, logs, attach, and wait behavior to Paseo.
- Use `paseo provider ls --json` to discover Agent Providers.
- Show only providers whose Paseo status is available and enabled.
- Use the Paseo provider label for display and the Paseo provider id for execution.
- Use `paseo run --detach --json` to start an Agent Run.
- Pass the selected repository path to Paseo as the working directory.
- Pass a generated worktree name to Paseo with the worktree option, but do not create the worktree in Kanban.
- Do not call provider-specific CLIs such as Codex or Pi from Kanban.
- Do not check provider-specific binaries directly. Kanban only needs Paseo to be available.
- Parse the Paseo run response for the Paseo agent id and any additional useful metadata available in JSON.
- Write one start Comment immediately after Paseo accepts the detached Agent Run.
- The start Comment includes the Agent Provider label, Paseo agent id, `paseo logs <id>`, and `paseo attach <id>`.
- Wait for the Paseo agent to finish in the main process background path.
- Write one finish Comment after the Paseo agent exits or reaches an idle/completed state.
- The finish Comment includes the Agent Provider label, Paseo agent id, completion status, `paseo logs <id>`, and a summary derived from Paseo output, inspect output, or logs.
- Do not stream progress into Comments.
- Do not edit the start Comment after creation.
- Add a main-process-to-renderer push event for Card changes or Card Comment changes.
- Emit the push event whenever a Comment is added by the main process.
- Renderer state reloads or patches the current Card when it receives a relevant push event.
- Keep the Agent Run Requirement Context in Kanban because Kanban owns Card language and Card data.
- Build the Agent Run prompt from the Card Title, Subtasks, and human-written Comments only.
- Prefix every Agent Run prompt with `/goal`.
- Label the Card Title in the prompt as `Requirement title`.
- Exclude Description from the Agent Run Requirement Context.
- Exclude prior Agent Run Comments from the Agent Run Requirement Context.
- Exclude repository path, worktree, branch, provider, Paseo agent id, logs, and attach information from the prompt.
- Keep repository path validation in Kanban before invoking Paseo, so users get immediate feedback for invalid folders.
- Preserve the existing Card detail panel shape with repository path selection, Agent Provider dropdown, validation status, and Run action.
- Respect ADR 0005 by using push events rather than renderer polling for Comment refresh.
- Respect ADR 0006 by keeping execution orchestration delegated to Paseo.
- Use project vocabulary consistently: Card, Comment, Agent Run, Agent Provider, and Agent Run Requirement Context.

## Testing Decisions

- Tests should verify external behavior through the highest stable seam available, not private implementation details.
- Main-process Agent Run service tests should mock command execution and verify provider discovery, provider filtering, Paseo invocation, start Comment creation, finish Comment creation, and failure Comment creation.
- Prompt construction tests should verify that the prompt starts with `/goal`, uses `Requirement title`, includes Subtasks, includes human-written Comments, excludes Description, excludes prior Agent Run Comments, and excludes execution context.
- Repository or Card persistence tests should continue to cover Comment addition as Card working context.
- IPC contract tests should cover the renderer-visible shape for provider listing, repository validation, run start, and pushed Card Comment changes.
- Renderer tests should cover Agent Provider dropdown population from available Paseo providers.
- Renderer tests should cover disabled Run behavior when no provider is available, no repository is selected, or repository validation fails.
- Renderer tests should cover receiving a pushed Card Comment change while the Card details panel is open.
- Renderer tests should cover that start and finish Comments appear without manual Card close/reopen.
- Existing board workspace state tests are prior art for renderer state reload behavior.
- Existing Kanban repository tests are prior art for Card and Comment persistence behavior.
- Existing IPC contract and preload patterns are prior art for adding new main-to-renderer events.
- Command parsing tests should use representative `paseo provider ls --json`, `paseo run --json`, `paseo wait --json`, `paseo inspect --json`, and `paseo logs` outputs.
- Failure tests should cover missing Paseo, daemon unavailable, no available providers, invalid repository path, malformed Paseo JSON, run start failure, and run finish failure.
- Build verification should include typecheck, unit tests, and production build.

## Out of Scope

- Cross-device collaboration.
- Multi-instance synchronization.
- Polling for Comment changes from the renderer.
- Continuous progress Comments.
- Editable or updatable Agent Run Comments.
- Managing Git worktrees in Kanban.
- Managing branch names or branch lifecycle in Kanban.
- Managing log files in Kanban.
- Calling Codex, Pi, or any provider-specific CLI directly from Kanban.
- Hardcoding Codex and Pi as the only Agent Providers.
- Including Description in the Agent Run Requirement Context.
- Including repository execution context in the Agent Run prompt.
- Changing the general Comment model beyond the push event needed for real-time refresh.
- Adding new remote issue tracker or project management integrations.

## Further Notes

This PRD follows the language captured in `CONTEXT.md` for Agent Run, Agent Provider, Agent Run Requirement Context, Card, and Comment.

Two ADRs govern the implementation:

- Push Card Comment changes from the main process.
- Delegate Agent Runs to Paseo.

The expected implementation should remove the earlier Kanban-owned worktree, branch, provider binary detection, and local log behavior. The final behavior should make Kanban a product-context collector and Paseo the execution orchestrator.

GitHub issue publication was attempted for `magenta9/kanban`, but the active GitHub account only has read permission on the repository. This PRD is therefore published locally as a markdown issue artifact until a writable issue tracker is available.
