# Architecture Deepening Opportunities PRD

## Problem Statement

The Kanban app has several domain behaviours that are working, but their knowledge is spread across shallow modules. Maintaining one behaviour often requires remembering hidden ordering, duplicated rules, or UI-specific state shapes.

The main affected areas are:

- Recurrence Series lifecycle behaviour for Recurring Cards, Recurrence Batons, Occurrences, Series Templates, and Blocked Recurrence Series.
- Inline Completion Suggestion behaviour for Conservative Suggestions and Completion Fragments.
- Card editing behaviour for Active Cards, Description, Comments, Subtasks, Labels, and autosave.
- Draft Card behaviour for card composer state, keyboard shortcuts, focus, submit, and cancel.
- Recurrence Rule behaviour where fixed cycles and Completion Column interactions decide whether a Recurrence Series generates, blocks, or stops.

The current architecture creates low locality: a maintainer must inspect multiple modules to understand one domain rule. It also creates low leverage: tests often target extracted helper functions rather than the interface through which real behaviour is exercised.

## Solution

Deepen five modules around domain concepts that already exist in the Kanban language. Each module should provide a small, stable interface that hides behaviour currently scattered across UI handlers, repository methods, prompt construction, response normalization, and evaluation scripts.

The goal is not to split files mechanically. The goal is to move domain knowledge behind seams where behaviour can be tested through the same interface callers use.

The five proposed modules are:

1. Recurrence Series Lifecycle Module
2. Inline Completion Suggestion Pipeline Module
3. Card Editing State Module
4. Draft Card Module
5. Recurrence Rule and Completion Column Interaction Module

## User Stories

1. As a maintainer, I want Recurrence Series lifecycle rules to live in one module, so that I can change Recurring Card behaviour without auditing every Card operation.
2. As a maintainer, I want Card updates, moves, archives, deletes, and Label changes to report domain events to one recurrence module, so that Recurrence Baton and Series Template side effects stay consistent.
3. As a maintainer, I want the rule for stopping a Recurrence Series when the Latest Occurrence is deleted or archived to be tested through a clear interface, so that ADR-backed behaviour does not regress.
4. As a user, I want a Recurring Card that reaches the Completion Column to create the next Occurrence reliably, so that recurring work continues without manual recreation.
5. As a user, I want a Recurrence Series to become a Blocked Recurrence Series when the board state cannot support the next Occurrence, so that the app does not create invalid Cards.
6. As a maintainer, I want fixed Recurrence Rule date calculation to be isolated, so that monthly anchor and catch-up behaviour can be changed without touching unrelated Card persistence code.
7. As a maintainer, I want Completion Column interactions with Recurrence Rules to be localized, so that changing Column behaviour does not silently break recurrence generation.
8. As a maintainer, I want Recurrence Rule tests to cover domain behaviour directly, so that test failures explain which rule broke.
9. As a maintainer, I want Inline Completion Suggestion request gating to be clearly separated from response normalization, so that cursor behaviour and Completion Fragment quality can evolve independently.
10. As a maintainer, I want Conservative Suggestion rules to have one source of truth, so that runtime prompts, evaluation fixtures, and tests do not drift.
11. As a user, I want Description completion to avoid repeating nearby Markdown or stale Card context, so that accepting a Completion Fragment does not create duplicate content.
12. As a user, I want Comment completion to stay grounded in current Card context, so that it does not invent owners, dates, decisions, or completion claims.
13. As a user, I want Subtask completion to produce a short actionable fragment, so that it fits naturally into an unfinished subtask title.
14. As a maintainer, I want Inline Completion Suggestion discard reasons to be explicit, so that logs and tests can distinguish request gating, prompt-level skip, model failure, and response rejection.
15. As a maintainer, I want evaluation scripts to use the same completion decision rules as runtime, so that offline scores predict product behaviour.
16. As a maintainer, I want Card editing state to be owned by a module, so that the UI does not need to coordinate every field, debounce, and save snapshot itself.
17. As a user, I want edits to Card Title, Description, dates, Priority, Subtasks, Comments, and Labels to save consistently, so that I can trust the Card detail panel.
18. As a maintainer, I want Card edit patch generation to be testable without rendering the full Card detail UI, so that small changes do not require brittle integration tests.
19. As a maintainer, I want Card switching to reset drafts and snapshots predictably, so that one Active Card's editing state cannot leak into another Card.
20. As a user, I want adding or editing a Comment to behave like part of the Card's working context, so that Inline Completion Suggestions and saves reflect the latest state.
21. As a maintainer, I want Draft Card behaviour to match the domain model, so that a Draft Card is represented as one concept rather than several unrelated state variables.
22. As a user, I want keyboard shortcuts to open a Draft Card in the expected Column, so that I can create Cards quickly without losing context.
23. As a user, I want cancelling a Draft Card to clear the draft and close the composer, so that abandoned text does not surprise me later.
24. As a user, I want submitting a Draft Card to create a Card and select it, so that I can immediately continue editing details.
25. As a maintainer, I want Draft Card focus behaviour to be tested through the Draft Card interface, so that Column composer UI changes do not break keyboard flow.
26. As a maintainer, I want Labels attached to a Recurring Card to update the Series Template only when the Recurrence Baton is active, so that future Occurrences inherit the intended work definition.
27. As a maintainer, I want old Occurrences to remain ordinary Cards after handing off the Recurrence Baton, so that editing history does not mutate future work.
28. As a maintainer, I want the AI Suggestion Profile and Conservative Suggestion policy to be explicit in the completion pipeline, so that style changes do not become hidden prompt edits.
29. As a user, I want Inline Completion Suggestions to appear only when the current cursor context is meaningful, so that the app stays quiet when it cannot make a grounded suggestion.
30. As a maintainer, I want each deep module to expose the same interface to callers and tests, so that tests document behaviour rather than implementation details.

## Implementation Decisions

- Build or modify a Recurrence Series Lifecycle Module. It owns Recurrence Baton handoff, Series Template updates, stopping a Recurrence Series, and creating the next Occurrence after completion.
- The Recurrence Series Lifecycle Module should initially be an internal module near persistence. It should not create a public renderer seam until at least two adapters or caller needs prove that seam is real.
- Preserve the ADR-backed rule that deleting or archiving the Latest Occurrence stops the Recurrence Series.
- Build or modify an Inline Completion Suggestion Pipeline Module. It owns the product-level decision from cursor context and current Card context to accepted, skipped, or discarded Completion Fragment.
- The Inline Completion Suggestion Pipeline Module should respect the existing Ollama structured-output decision. It should not reopen provider support decisions superseded by the Ollama-only ADR.
- Inline Completion Suggestion request gating should remain close to cursor and focus state, but Conservative Suggestion policy, prompt payload construction, response normalization, and discard reasons should share one domain rule set.
- Runtime and evaluation should use the same completion decision path wherever practical. Divergence must be deliberate and named.
- Build or modify a Card Editing State Module. It owns editable Card snapshots, dirty checks, debounced save, Card switch reset behaviour, and mutations for Description, Comments, Subtasks, and Card metadata.
- Card editing UI should consume state and commands from the Card Editing State Module rather than coordinating all save semantics directly.
- Build or modify a Draft Card Module. It owns opening, typing, submitting, cancelling, and focusing a Draft Card in a Board and Column context.
- Draft Card behaviour should use the domain term Draft Card in the interface and tests. It should not expose column-indexed implementation maps as the primary interface.
- Build or modify a Recurrence Rule and Completion Column Interaction Module. It owns fixed-cycle due generation, completion-trigger generation, catch-up limits, date anchors, and blocking when Completion Column state cannot support recurrence.
- The Recurrence Rule module should start as an internal module. A separate adapter seam should be added only when real variation exists.
- Do not perform a broad mechanical split of the Kanban page as the first step. Extract behaviour when it increases depth, leverage, and locality.
- Do not introduce generic abstractions for all Board, Column, Card, and Label operations unless they directly support one of the five deep modules.
- Use the project domain vocabulary consistently: Board, Column, Card, Draft Card, Active Card, Archived Card, Label, Completion Column, Recurring Card, Recurrence Series, Series Template, Recurrence Baton, Occurrence, Latest Occurrence, Inline Completion Suggestion, Completion Fragment, Conservative Suggestion, and Suggestion Profile.

## Testing Decisions

- Tests should exercise the interface of each deep module. The interface is the test surface.
- Avoid tests that only prove a helper function was extracted. A good test should fail when user-visible or domain-visible behaviour regresses.
- Recurrence Series Lifecycle tests should cover Recurrence Baton handoff, Series Template updates, deleting or archiving the Latest Occurrence, and generation after moving a Card into the Completion Column.
- Recurrence Rule tests should cover fixed-cycle due dates, monthly anchors, catch-up limits, completion-trigger generation, and Blocked Recurrence Series reasons.
- Inline Completion Suggestion Pipeline tests should cover Description, Comment, and Subtask scenarios; current cursor line gating; unsupported fact rejection; duplicate-context rejection; suffix-aware insertion; and empty Completion Fragment decisions.
- Inline Completion Suggestion evaluation should keep using representative fixtures, but fixtures should map to named domain rules or scenarios rather than existing only as prose expectations.
- Card Editing State tests should cover snapshot creation, dirty detection, debounced save scheduling, patch generation, Card switch reset, subtask mutation, comment mutation, and save failure recovery.
- Draft Card tests should cover open, focus, type, submit, cancel, keyboard shortcut target selection, and composer close behaviour.
- Existing test suites for kanban editing, shortcuts, repository behaviour, AI settings, and AI suggestions are prior art. New tests should either deepen those suites or add focused module tests when the module interface becomes stable.
- Integration tests should be added only where multiple modules meet at a real seam, such as renderer cursor state calling the AI suggestion adapter or Card operations triggering recurrence persistence.

## Out of Scope

- Reopening the decision to use Ollama native structured output for AI suggestions.
- Reintroducing OpenAI-compatible provider support.
- Redesigning the full Kanban UI layout.
- Rewriting the entire repository layer.
- Creating public renderer APIs for Recurrence Series before a clear caller need exists.
- Changing the domain rule that a Card is completed by belonging to the Board's Completion Column.
- Changing Label semantics or UI wording beyond what is required for these modules.
- Adding new recurrence trigger modes beyond fixed and completion unless a separate PRD approves them.
- Building issue tracker tickets from this PRD. That can be a follow-up step.

## Further Notes

This PRD intentionally treats the five items as architecture deepening work, not feature expansion. The expected outcome is higher locality and leverage: fewer places to inspect for one domain rule, and tests that describe the behaviour through stable module interfaces.

The highest-priority starting points are the Inline Completion Suggestion Pipeline Module and the Recurrence Series Lifecycle Module. The completion pipeline has recent evaluation and prompt history, so it is likely to produce fast feedback. The recurrence lifecycle work is deeper domain infrastructure and should be approached more carefully because it touches persistence and ADR-backed behaviour.

Issue tracker publication was not completed because issue tracker configuration and triage label vocabulary were not available in the current context.
