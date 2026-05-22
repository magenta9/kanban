# Recurring Cards Plan

## Goal

Add first-class recurrence support to the Kanban app so a card can generate future cards either on a fixed local schedule or after the current recurring card is completed.

## Confirmed Domain Decisions

- Domain language uses Card, not Task.
- A Board has one Completion Column. A Card is completed when it belongs to that Completion Column.
- New Boards default their Completion Column to the default Done column, but the user can change it.
- A Recurrence Series owns one Recurrence Rule and one active Recurrence Baton.
- Only the Latest Occurrence holds the Recurrence Baton. After it generates the next Occurrence, the old Card becomes an ordinary Card.
- A Recurring Card is the Card currently holding the Recurrence Baton.
- An Occurrence is a Card generated for one scheduled cycle.
- The Occurrence Date is the date the Occurrence represents in the Series.
- Editing the current Recurring Card updates the Series Template and can affect future Occurrences.
- Editing an old Occurrence after it handed off the Recurrence Baton affects only that Card.
- Subtask structure propagates to future Occurrences, but subtask completed state does not.
- Comments do not propagate to future Occurrences.
- Stopped Series do not show recurrence indicators on Cards.
- Blocked Series are shown only in Card Detail.

## Confirmed Behavior

- Trigger modes are mutually exclusive: Fixed-time or Completion-triggered.
- Supported cycles for v1: daily, weekly, monthly.
- Fixed-time recurrence runs at 08:00 in the device's local timezone. The user does not choose the time.
- Fixed-time recurrence scans all Boards while the app is running.
- If the app was not running, missed fixed-time Occurrences are created the next time the app runs.
- If more than 7 fixed-time Occurrences were missed, create only the most recent 7 and skip older missed cycles.
- Fixed-time recurrence creates new Occurrences even if previous Occurrences are unfinished.
- Completion-triggered recurrence creates the next Occurrence immediately after the current Recurring Card enters the Completion Column.
- Completion-triggered recurrence computes the next Occurrence Date from the completion date plus the cycle.
- Each Occurrence can trigger the next Occurrence only once.
- Enabling recurrence on an existing Card makes that Card the first Occurrence and does not immediately duplicate it.
- The initial Occurrence Date comes from the Card startDate; if absent, it uses today.
- New Occurrences are created in the first active non-completion Column by Board order.
- If no active non-completion Column exists, create a Todo Column immediately before the Completion Column, then place the Occurrence there.
- New Occurrences are appended to the bottom of the target Column.
- Deleting or archiving the latest Card that holds the Recurrence Baton stops the Series.
- Deleting or archiving older ordinary Occurrences does not stop the Series.
- Archived Cards cannot start or hold recurrence.
- If the Completion Column is archived or missing, Completion-triggered Series become blocked; Fixed-time Series continue.
- Board export/import includes Recurrence Series, Rules, templates, and occurrence relationships with remapped IDs.
- Automatic Occurrence creation is completely silent: no system notification and no toast.

## Confirmed Date Rules

- Daily: next day from the anchor date.
- Weekly: same weekday as the anchor date.
- Monthly: same day-of-month as the anchor date; short months clamp to month end.
- If the source Card is single-day, the new Occurrence has startDate = endDate = target date.
- If the source Card has a date range, the new Occurrence shifts the whole range by the cycle.
- If the source Card has no date, the new Occurrence receives the target date.
- Changing the current Recurring Card startDate changes its Occurrence Date and can affect the next generation.
- Changing an old ordinary Occurrence date does not affect the Series.

## Confirmed UI Decisions

- Card Detail gets the recurrence controls next to Date Range, using a popover interaction similar to the current date range picker.
- Kanban/List Card footer shows a recurrence icon on the right side of the existing date area when the Card currently holds the Recurrence Baton.
- Card Detail Date Range row shows the recurrence status/rule to the right of Date Range.
- Stopped recurrence indicators are hidden.
- Blocked recurrence details appear only inside Card Detail.
- Column header keeps the Rename button.
- Column header adds an ellipsis button.
- Archive and Set as Completion Column move into the ellipsis dropdown.
- The current Completion Column should have a visible column-level marker.

## Current Code Facts

- Shared Kanban types live in `packages/shared/src/types/kanban.ts`.
- IPC contract lives in `packages/shared/src/ipc-contract.ts` and preload mapping in `packages/preload/src/api.ts`.
- SQLite schema migration lives in `packages/main/src/db/schema.ts`.
- Main repository logic lives in `packages/main/src/db/repositories/kanban-repository.ts`.
- New Boards currently create default columns: Backlog, Todo, In Progress, Done.
- Cards currently have `columnId`, date fields, priority, labels, subtasks, comments, and archivedAt; there is no Card status field.
- Renderer Kanban UI is concentrated in `packages/renderer/src/tools/kanban/kanban.tsx`.
- Existing Card creation appends to the target Column by using the next sort order.
- Existing Board export/import already remaps Board, Column, Card, and Label IDs.

## Proposed Data Model

1. Add Board-level Completion Column storage.
   - Store `completion_column_id` on `kanban_boards`, nullable for migrated boards until backfilled.
   - During migration/backfill, choose the active column named Done if present, otherwise the last active column.
   - For new Boards, set it to the default Done column id.

2. Add recurrence series storage.
   - Suggested table: `kanban_recurrence_series`.
   - Fields should cover: id, board_id, rule trigger mode, cycle, active_baton_card_id, template payload, status, blocked reason, last generated occurrence date, createdAt, updatedAt, stoppedAt.
   - Keep trigger mode and cycle as explicit enum-like strings.
   - Store the Series Template as structured JSON containing title, description, priority, labels, date shape, and subtask structure.

3. Add occurrence relationship storage.
   - Suggested table: `kanban_recurrence_occurrences`.
   - Fields should cover: series_id, card_id, occurrence_date, generated_next_at, createdAt.
   - This provides idempotency for completion-triggered generation and lets export/import preserve relationships.

4. Add shared types.
   - Add recurrence trigger mode, cycle, status, Series, Occurrence metadata, and Card recurrence summary types.
   - Add recurrence summary onto KanbanCard only if the renderer needs per-card display without extra lookups.

## Proposed Backend Work

1. Extend migrations.
   - Add completion column support.
   - Add recurrence series and occurrence tables.
   - Backfill completion columns for existing Boards.

2. Extend repository methods.
   - Get/set Completion Column.
   - Enable recurrence for a Card.
   - Update recurrence rule.
   - Stop recurrence when the active baton Card is deleted or archived.
   - Generate due fixed-time Occurrences across all Boards.
   - Generate the next Occurrence when a completion-triggered recurring Card enters the Completion Column.
   - Update Series Template when the current Recurring Card's work definition changes.
   - Ensure old ordinary Occurrences do not update the Series Template.

3. Integrate generation into existing Card mutations.
   - `updateCard` and `reorderCard` can both move a Card into the Completion Column, so both need completion-trigger checks.
   - `deleteCard` and `archiveCard` need to stop the Series if the Card is the active baton Card.
   - Card date and work definition changes need to update the Series Template only when the Card is the active baton Card.

4. Add fixed-time scheduler in the main process.
   - On app startup, run a catch-up scan.
   - While the app is open, schedule or poll enough to create due Occurrences at local 08:00.
   - The scheduler should scan all Boards, not just the selected Board.
   - Generation should be silent.

5. Extend export/import.
   - Include recurrence tables in `KanbanBoardExport` version 2 or add a backward-compatible optional field.
   - Remap Series, Card, Column, and Label IDs on import.
   - Import should preserve active baton semantics for the copied Board.

## Proposed Renderer Work

1. Add recurrence UI in Card Detail.
   - Date Range row gets a recurrence status control on the right.
   - Clicking opens a popover similar to DateRangePicker.
   - The popover supports enable/disable by the implicit stop rule, trigger mode, cycle, and blocked detail.

2. Add Card footer indicator.
   - Show a small icon on the right side of the date footer only when the Card holds the active Recurrence Baton.
   - Hide indicators for stopped Series.
   - Do not show blocked warnings on the Card surface; blocked reason appears in Detail only.

3. Add Completion Column controls.
   - Keep column Rename as a direct button.
   - Add an ellipsis menu to Column headers.
   - Move Archive into that menu.
   - Add Set as Completion Column into that menu.
   - Mark the current Completion Column visually.

4. Refresh data after silent generation.
   - If automatic generation affects the currently selected Board, refresh Card data without toast.
   - Boards not currently open can be loaded normally when selected.

## Tests

- Repository migration tests for completion column backfill and new Board defaults.
- Repository tests for enabling recurrence on existing Cards.
- Repository tests for fixed-time generation, including catch-up limit of most recent 7.
- Repository tests for completion-trigger generation and idempotency.
- Repository tests that old Occurrences become ordinary and no longer update future template.
- Repository tests for active baton transfer in single and batch generation.
- Repository tests for delete/archive active baton stopping the Series.
- Repository tests for archived Cards not holding recurrence.
- Repository tests for missing Completion Column blocking completion-triggered Series only.
- Export/import round-trip tests for recurrence data and remapped IDs.
- Renderer tests for recurrence status formatting and interaction helpers where practical.

## Validation Commands

- `pnpm --filter @kanban/shared build`
- `pnpm --filter @kanban/main typecheck`
- `pnpm --filter @kanban/renderer typecheck`
- `pnpm exec vitest run --config vitest.config.ts packages/main/src/db/repositories/kanban-repository.test.ts`
- `pnpm exec vitest run --config vitest.config.ts packages/renderer/src/tools/kanban/kanban-editor.test.ts packages/renderer/src/tools/kanban/kanban-shortcuts.test.ts`

## Non-Goals For V1

- No custom intervals such as every 2 days.
- No user-selected fixed time; fixed-time recurrence always uses local 08:00.
- No system notification or toast for automatic generation.
- No system-level background helper when the app is closed.
- No multiple active recurrence batons per Series.
- No recurrence on archived Cards.
- No full history UI for stopped Series.
