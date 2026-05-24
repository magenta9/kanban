# Architecture Deepening Issue Breakdown

Parent PRD: thoughts/shared/prd/architecture-deepening-opportunities-prd.md

## Proposed Breakdown

1. **Title**: Establish Inline Completion Suggestion decision reasons
   **Type**: AFK
   **Blocked by**: None
   **User stories covered**: 9, 10, 14, 15, 28, 29, 30

   **What to build**

   Introduce a named decision result for Inline Completion Suggestion requests so runtime, tests, logs, and evaluation can distinguish request gating, prompt-level skip, response rejection, and accepted Completion Fragment behaviour.

   **Acceptance criteria**

   - [ ] Inline Completion Suggestion outcomes expose stable reason names for accepted, skipped, discarded, and failed suggestions.
   - [ ] Existing runtime logging uses the named reasons where applicable.
   - [ ] Existing evaluation output can report the same decision reasons without duplicating runtime rules.
   - [ ] Tests cover at least one accepted Completion Fragment and one empty Conservative Suggestion decision per field type.

2. **Title**: Deepen Description completion duplicate rejection
   **Type**: AFK
   **Blocked by**: 1
   **User stories covered**: 10, 11, 14, 15, 29, 30

   **What to build**

   Move Description-specific duplicate and cursor-fit rules behind the Inline Completion Suggestion pipeline interface, then route runtime and evaluation through that interface for Description scenarios.

   **Acceptance criteria**

   - [ ] Description completion rejects repeated nearby Markdown lines through the shared pipeline decision path.
   - [ ] Description completion preserves valid unfinished Markdown continuations.
   - [ ] Evaluation fixtures for repeated headings, repeated list items, and suffix-aware insertion use the shared decision path.
   - [ ] Tests describe domain scenarios rather than helper implementation details.

3. **Title**: Deepen Subtask and Comment completion grounding
   **Type**: AFK
   **Blocked by**: 1
   **User stories covered**: 12, 13, 14, 15, 28, 29, 30

   **What to build**

   Route Subtask and Comment completion through the same Inline Completion Suggestion pipeline decisions, with field-specific Conservative Suggestion rules for sibling Subtasks, prior Comments, promises, and unsupported facts.

   **Acceptance criteria**

   - [ ] Subtask completion rejects duplicate sibling Subtasks and unsupported promises through named decision reasons.
   - [ ] Comment completion rejects invented resolution, completion, owner, or date claims through named decision reasons.
   - [ ] Runtime and evaluation use the same field-specific grounding rules.
   - [ ] Tests cover at least one accepted and one rejected Subtask and Comment scenario.

4. **Title**: Extract Card Editing State autosave interface
   **Type**: AFK
   **Blocked by**: None
   **User stories covered**: 16, 17, 18, 19, 20, 30

   **What to build**

   Introduce a Card Editing State module that owns editable snapshots, dirty detection, patch generation, debounced save scheduling, and Card switch reset behaviour while preserving the existing Card detail user experience.

   **Acceptance criteria**

   - [ ] Card editing UI consumes snapshot state and commands from the Card Editing State module.
   - [ ] Card switch resets editing drafts and saved snapshots predictably.
   - [ ] Debounced save sends the same Card patch semantics as before.
   - [ ] Tests cover dirty detection, patch generation, save scheduling, and Card switch reset without rendering the full Card detail UI.

5. **Title**: Move Subtask and Comment mutations into Card Editing State
   **Type**: AFK
   **Blocked by**: 4
   **User stories covered**: 17, 18, 20, 30

   **What to build**

   Move Subtask and Comment creation, update, reorder, and deletion rules into the Card Editing State interface so the UI no longer owns those mutation details.

   **Acceptance criteria**

   - [ ] Subtask add, edit, complete, delete, and reorder operations are exposed as Card Editing State commands.
   - [ ] Comment add and delete operations are exposed as Card Editing State commands.
   - [ ] Description and Comment state remain part of current Card context for Inline Completion Suggestions.
   - [ ] Tests cover mutation results and autosave interaction through the Card Editing State interface.

6. **Title**: Model Draft Card lifecycle as one module
   **Type**: AFK
   **Blocked by**: None
   **User stories covered**: 21, 22, 23, 24, 25, 30

   **What to build**

   Introduce a Draft Card module that owns open, type, submit, cancel, and focus behaviour for a Draft Card in a Board and Column context.

   **Acceptance criteria**

   - [ ] Draft Card state is represented as one domain concept rather than separate title, active Column, and focus maps.
   - [ ] Keyboard shortcut target selection opens the expected Draft Card.
   - [ ] Cancelling clears the Draft Card and closes the composer.
   - [ ] Submitting creates a Card, clears the Draft Card, and selects the new Card.
   - [ ] Tests cover open, focus, type, submit, cancel, and keyboard target selection through the Draft Card interface.

7. **Title**: Introduce Recurrence Series lifecycle interface
   **Type**: HITL
   **Blocked by**: None
   **User stories covered**: 1, 2, 3, 4, 5, 26, 27, 30

   **What to build**

   Agree on the internal seam for Recurrence Series lifecycle behaviour, then introduce a module that centralizes Recurrence Baton handoff, Series Template updates, Occurrence generation, and stopping a Recurrence Series.

   **Acceptance criteria**

   - [ ] The chosen seam keeps Recurrence Series lifecycle internal until a real public adapter need exists.
   - [ ] Card update, move, archive, delete, and Label changes call into the lifecycle module instead of owning recurrence side effects directly.
   - [ ] ADR-backed Latest Occurrence stop behaviour is preserved.
   - [ ] Tests verify Recurrence Baton handoff, Series Template updates, Occurrence generation, and stop behaviour through the lifecycle interface.

8. **Title**: Centralize Completion Column recurrence generation
   **Type**: AFK
   **Blocked by**: 7
   **User stories covered**: 4, 5, 7, 26, 27, 30

   **What to build**

   Move completion-trigger generation and Blocked Recurrence Series decisions behind the Recurrence Series lifecycle interface so Completion Column state is handled in one place.

   **Acceptance criteria**

   - [ ] Moving a Recurring Card into the Completion Column generates the next Occurrence exactly once.
   - [ ] Missing or archived Completion Column state blocks the Recurrence Series with a clear reason.
   - [ ] Editing an old Occurrence after Baton handoff does not update the Series Template.
   - [ ] Tests cover successful generation, blocked generation, and old Occurrence edits.

9. **Title**: Extract fixed Recurrence Rule calculations
   **Type**: AFK
   **Blocked by**: 7
   **User stories covered**: 6, 8, 30

   **What to build**

   Move fixed Recurrence Rule date calculation, monthly anchor handling, and catch-up limit behaviour into an internal rule module used by due generation.

   **Acceptance criteria**

   - [ ] Fixed daily, weekly, and monthly due generation use the rule module.
   - [ ] Monthly anchor behaviour is covered by direct rule tests.
   - [ ] Catch-up limit behaviour is preserved and tested.
   - [ ] Due generation tests verify domain behaviour without relying on unrelated Card operations.

10. **Title**: Add recurrence recovery visibility without public redesign
    **Type**: HITL
    **Blocked by**: 8, 9
    **User stories covered**: 5, 7, 8

    **What to build**

    Decide whether Blocked Recurrence Series recovery needs a user-facing flow now. If yes, define the smallest interface that lets users understand and repair a blocked recurrence without redesigning the recurrence model.

    **Acceptance criteria**

    - [ ] Decision is recorded: defer recovery UI, expose a minimal repair path, or write an ADR explaining why not.
    - [ ] If a repair path is chosen, acceptance criteria for restoring or changing the Completion Column are documented before implementation.
    - [ ] Existing block behaviour remains visible in tests even if recovery UI is deferred.

## Review Questions

1. Does this granularity feel right, too coarse, or too fine?
2. Are the dependency relationships correct?
3. Should any slices be merged or split further?
4. Are the HITL slices correct, especially the Recurrence Series lifecycle seam and blocked recurrence recovery decision?
5. Should local issue drafts be published later when issue tracker configuration is available?
