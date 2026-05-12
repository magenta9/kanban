import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../schema";
import { KanbanRepository, orderBetween } from "./kanban-repository";

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

    it("persists card subtasks and comments", () => {
        const repository = createRepository();
        const board = repository.createBoard({ name: "Launch" });
        const [backlog] = repository.listColumns({ boardId: board.id });
        const card = repository.createCard({ boardId: board.id, columnId: backlog!.id, title: "Ship" });

        const updated = repository.updateCard({
            id: card.id,
            patch: {
                subtasks: [{ id: "subtask-1", title: "Write notes", completed: false, createdAt: 1, updatedAt: 1 }],
                comments: [{ id: "comment-1", body: "Looks ready", createdAt: 2, updatedAt: 2 }]
            }
        });

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
