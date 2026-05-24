import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../schema";
import { KanbanRepository, orderBetween } from "./kanban-repository";
import { unavailableCompletionColumnReason } from "./recurrence-lifecycle";

function createRepository(): KanbanRepository {
    const database = new Database(":memory:");
    migrate(database);
    return new KanbanRepository(database);
}

describe("KanbanRepository", () => {
    it("creates a board with the default columns", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });

        expect(repository.listBoards()).toHaveLength(1);
        expect(repository.listColumns({ boardId: board.id }).map((column) => column.name)).toEqual([
            "Backlog",
            "Todo",
            "In Progress",
            "Done"
        ]);
        expect(repository.listBoards()[0]?.completionColumnId).toBe(repository.listColumns({ boardId: board.id }).at(-1)?.id);
    });

    it("sets the board completion column", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });

        const updated = repository.setCompletionColumn({ boardId: board.id, columnId: backlog!.id });

        expect(updated.completionColumnId).toBe(backlog!.id);
    });

    it("moves cards across columns with fractional ordering", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog, todo] = repository.listColumns({ boardId: board.id });
        const first = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "First" });
        repository.createCard({ boardId: board.id, columnId: todo!.id, title: "Second" });

        const moved = repository.reorderCard({ id: first.id, toColumnId: todo!.id });

        expect(moved.columnId).toBe(todo!.id);
        expect(repository.listCards({ boardId: board.id }).filter((card) => card.columnId === todo!.id)).toHaveLength(2);
        expect(orderBetween(1000, 2000)).toBe(1500);
    });

    it("blocks archiving non-empty columns", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Keep me visible" });

        expect(() => repository.archiveColumn({ id: backlog!.id })).toThrow(/Move or archive active cards/);
    });

    it("archives and restores cards", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Ship" });

        repository.archiveCard({ id: card.id });
        expect(repository.listCards({ boardId: board.id })).toHaveLength(0);
        expect(repository.listCards({ boardId: board.id, includeArchived: true })).toHaveLength(1);

        repository.restoreCard({ id: card.id });
        expect(repository.listCards({ boardId: board.id })).toHaveLength(1);
    });

    it("lists only labels used by active cards", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const activeCard = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Active" });
        const archivedCard = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Archived" });
        const mixedCard = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Mixed" });
        const unusedLabel = repository.createLabel({ boardId: board.id, name: "Unused", color: "#64748b" });
        const activeLabel = repository.createLabel({ boardId: board.id, name: "Active", color: "#2563eb" });
        const archivedOnlyLabel = repository.createLabel({ boardId: board.id, name: "Archived only", color: "#f97316" });
        const mixedLabel = repository.createLabel({ boardId: board.id, name: "Mixed", color: "#16a34a" });

        repository.setCardLabels({ cardId: activeCard.id, labelIds: [activeLabel.id, mixedLabel.id] });
        repository.setCardLabels({ cardId: archivedCard.id, labelIds: [archivedOnlyLabel.id, mixedLabel.id] });
        repository.setCardLabels({ cardId: mixedCard.id, labelIds: [mixedLabel.id] });
        repository.archiveCard({ id: archivedCard.id });

        expect(repository.listLabels({ boardId: board.id }).map((label) => label.name)).toEqual(["Active", "Mixed"]);

        repository.archiveCard({ id: activeCard.id });
        expect(repository.listLabels({ boardId: board.id }).map((label) => label.name)).toEqual(["Mixed"]);

        repository.archiveCard({ id: mixedCard.id });
        expect(repository.listLabels({ boardId: board.id })).toHaveLength(0);

        repository.restoreCard({ id: archivedCard.id });
        expect(repository.listLabels({ boardId: board.id }).map((label) => label.name)).toEqual(["Archived only", "Mixed"]);

        repository.setCardLabels({ cardId: archivedCard.id, labelIds: [unusedLabel.id] });
        expect(repository.listLabels({ boardId: board.id }).map((label) => label.name)).toEqual(["Unused"]);
    });

    it("persists card markdown descriptions, subtasks, and comments", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Ship" });

        const updated = repository.updateCard({
            id: card.id,
            patch: {
                descriptionMarkdown: "## Scope\n\n- Ship [notes](https://example.com)",
                subtasks: [{ id: "subtask-1", title: "Write notes", completed: false, createdAt: 1, updatedAt: 1 }],
                comments: [{ id: "comment-1", body: "Looks ready", createdAt: 2, updatedAt: 2 }]
            }
        });

        expect(updated.descriptionMarkdown).toBe("## Scope\n\n- Ship [notes](https://example.com)");
        expect(updated.descriptionText).toBe("Scope\nShip notes");
        expect(updated.subtasks[0]?.title).toBe("Write notes");
        expect(repository.listCards({ boardId: board.id })[0]?.comments[0]?.body).toBe("Looks ready");
    });

    it("persists and clears card date ranges", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Schedule" });

        const legacyUpdated = repository.updateCard({ id: card.id, patch: { dueDate: 1717113600000 } });
        expect(legacyUpdated).toMatchObject({
            dueDate: 1717113600000,
            startDate: 1717113600000,
            endDate: 1717113600000
        });

        repository.updateCard({ id: card.id, patch: { startDate: 1717200000000, endDate: 1717459200000 } });
        expect(repository.listCards({ boardId: board.id })[0]).toMatchObject({
            dueDate: undefined,
            startDate: 1717200000000,
            endDate: 1717459200000
        });

        const clearedStart = repository.updateCard({ id: card.id, patch: { startDate: null } });
        expect(clearedStart.startDate).toBeUndefined();
        expect(clearedStart.endDate).toBe(1717459200000);

        const clearedBoth = repository.updateCard({ id: card.id, patch: { startDate: null, endDate: null } });
        expect(clearedBoth.dueDate).toBeUndefined();
        expect(clearedBoth.startDate).toBeUndefined();
        expect(clearedBoth.endDate).toBeUndefined();
    });

    it("round-trips exported boards with labels", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Design" });
        repository.updateCard({ id: card.id, patch: { startDate: 1717200000000, endDate: 1717459200000 } });
        const label = repository.createLabel({ boardId: board.id, name: "UI", color: "#2563eb" });
        repository.setCardLabels({ cardId: card.id, labelIds: [label.id] });

        const imported = repository.importBoard({ payload: repository.exportBoard({ boardId: board.id }) });

        expect(imported.name).toBe("Launch Copy");
        expect(repository.listColumns({ boardId: imported.id, includeArchived: true })).toHaveLength(4);
        expect(repository.listCards({ boardId: imported.id, includeArchived: true })[0]).toMatchObject({
            labelIds: [expect.any(String)],
            startDate: 1717200000000,
            endDate: 1717459200000
        });
        expect(repository.listLabels({ boardId: imported.id })[0]?.name).toBe("UI");
    });

    it("creates the next occurrence when the recurring card reaches the completion column", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Habits" });
        const [backlog, , , done] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Review notes" });
        repository.updateCard({
            id: card.id,
            patch: {
                startDate: date(2026, 4, 22),
                endDate: date(2026, 4, 22),
                subtasks: [{ id: "subtask-1", title: "Read", completed: true, createdAt: 1, updatedAt: 1 }]
            }
        });
        repository.enableCardRecurrence({ cardId: card.id, trigger: "completion", cycle: "daily" });

        repository.updateCard({ id: card.id, patch: { columnId: done!.id } });

        const cards = repository.listCards({ boardId: board.id });
        const originalCard = cards.find((item) => item.id === card.id);
        const nextCard = cards.find((item) => item.id !== card.id);
        expect(cards).toHaveLength(2);
        expect(originalCard?.recurrence).toBeUndefined();
        expect(nextCard).toMatchObject({ title: "Review notes", columnId: backlog!.id });
        expect(nextCard?.recurrence).toMatchObject({ trigger: "completion", cycle: "daily", status: "active" });
        expect(nextCard?.subtasks[0]).toMatchObject({ title: "Read", completed: false });
    });

    it("blocks completion recurrence when the completion column is archived", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Habits" });
        const [backlog, , , done] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Review notes" });
        repository.enableCardRecurrence({ cardId: card.id, trigger: "completion", cycle: "daily" });

        repository.archiveColumn({ id: done!.id });
        repository.updateCard({ id: card.id, patch: { columnId: done!.id } });

        const cards = repository.listCards({ boardId: board.id });
        expect(cards).toHaveLength(1);
        expect(cards[0]?.recurrence).toMatchObject({
            trigger: "completion",
            cycle: "daily",
            status: "blocked",
            blockedReason: unavailableCompletionColumnReason
        });
    });

    it("does not update the Series Template when an old Occurrence is edited after Baton handoff", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Habits" });
        const [backlog, , , done] = repository.listColumns({ boardId: board.id });
        const originalCard = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Review notes" });
        repository.updateCard({
            id: originalCard.id,
            patch: { subtasks: [{ id: "subtask-1", title: "Read", completed: true, createdAt: 1, updatedAt: 1 }] }
        });
        repository.enableCardRecurrence({ cardId: originalCard.id, trigger: "completion", cycle: "daily" });
        repository.updateCard({ id: originalCard.id, patch: { columnId: done!.id } });
        const nextCard = repository.listCards({ boardId: board.id }).find((item) => item.id !== originalCard.id)!;

        repository.updateCard({
            id: originalCard.id,
            patch: {
                title: "Edited old occurrence",
                subtasks: [{ id: "subtask-2", title: "Do not carry forward", completed: true, createdAt: 2, updatedAt: 2 }]
            }
        });
        repository.updateCard({ id: nextCard.id, patch: { columnId: done!.id } });

        const newestCard = repository.listCards({ boardId: board.id }).find((item) => item.id !== originalCard.id && item.id !== nextCard.id);
        expect(newestCard).toMatchObject({ title: "Review notes", columnId: backlog!.id });
        expect(newestCard?.subtasks[0]).toMatchObject({ title: "Read", completed: false });
    });

    it("generates only the latest seven missed fixed-time occurrences", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Habits" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Daily log" });
        repository.updateCard({ id: card.id, patch: { startDate: date(2026, 0, 1), endDate: date(2026, 0, 1) } });
        repository.enableCardRecurrence({ cardId: card.id, trigger: "fixed", cycle: "daily" });

        repository.generateDueRecurrences({ now: new Date(2026, 0, 12, 9).getTime() });

        const cards = repository.listCards({ boardId: board.id });
        expect(cards).toHaveLength(8);
        expect(cards.filter((item) => item.recurrence)).toHaveLength(1);
        expect(cards.some((item) => item.startDate === date(2026, 0, 2))).toBe(false);
        expect(cards.some((item) => item.startDate === date(2026, 0, 12))).toBe(true);
    });

    it("stops recurrence when the baton card is archived", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Habits" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Daily log" });
        repository.enableCardRecurrence({ cardId: card.id, trigger: "fixed", cycle: "daily" });

        repository.archiveCard({ id: card.id });

        expect(repository.listCards({ boardId: board.id, includeArchived: true })[0]?.recurrence).toBeUndefined();
        repository.generateDueRecurrences({ now: new Date(2026, 0, 12, 9).getTime() });
        expect(repository.listCards({ boardId: board.id, includeArchived: true })).toHaveLength(1);
    });

    it("stops recurrence when it is disabled from the baton card", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Habits" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Daily log" });
        repository.enableCardRecurrence({ cardId: card.id, trigger: "fixed", cycle: "daily" });

        const updated = repository.disableCardRecurrence({ cardId: card.id });

        expect(updated.recurrence).toBeUndefined();
        repository.generateDueRecurrences({ now: new Date(2026, 0, 12, 9).getTime() });
        expect(repository.listCards({ boardId: board.id, includeArchived: true })).toHaveLength(1);
    });

    it("keeps monthly fixed recurrence anchored to the original day", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Finance" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Close books" });
        repository.updateCard({ id: card.id, patch: { startDate: date(2026, 0, 31), endDate: date(2026, 0, 31) } });
        repository.enableCardRecurrence({ cardId: card.id, trigger: "fixed", cycle: "monthly" });

        repository.generateDueRecurrences({ now: new Date(2026, 2, 31, 9).getTime() });

        const dates = repository.listCards({ boardId: board.id }).map((item) => item.startDate).sort();
        expect(dates).toContain(date(2026, 1, 28));
        expect(dates).toContain(date(2026, 2, 31));
    });

    it("backfills legacy due dates as single-day ranges", () => {
        const database = new Database(":memory:");
        database.exec(`
            CREATE TABLE kanban_boards (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              archived_at INTEGER
            );
            CREATE TABLE kanban_columns (
              id TEXT PRIMARY KEY,
              board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              color TEXT,
              sort_order REAL NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              archived_at INTEGER
            );
            CREATE TABLE kanban_cards (
              id TEXT PRIMARY KEY,
              board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
              column_id TEXT NOT NULL REFERENCES kanban_columns(id) ON DELETE RESTRICT,
              title TEXT NOT NULL,
              description_json TEXT,
              description_text TEXT,
              priority TEXT NOT NULL DEFAULT 'none',
              due_date INTEGER,
              sort_order REAL NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              archived_at INTEGER
            );
            INSERT INTO kanban_boards (id, name, created_at, updated_at) VALUES ('board-1', 'Legacy', 1, 1);
            INSERT INTO kanban_columns (id, board_id, name, sort_order, created_at, updated_at) VALUES ('column-1', 'board-1', 'Todo', 1000, 1, 1);
            INSERT INTO kanban_cards (id, board_id, column_id, title, priority, due_date, sort_order, created_at, updated_at)
            VALUES ('card-1', 'board-1', 'column-1', 'Legacy due', 'none', 1717200000000, 1000, 1, 1);
        `);

        migrate(database);
        const repository = new KanbanRepository(database);

        expect(repository.listCards({ boardId: "board-1" })[0]).toMatchObject({
            dueDate: 1717200000000,
            startDate: 1717200000000,
            endDate: 1717200000000
        });
    });
});

function date(year: number, month: number, day: number): number {
    return new Date(year, month, day).getTime();
}
