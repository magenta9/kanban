import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KanbanBoard, KanbanCard, KanbanColumn, KanbanLabel, PreloadApi } from "@kanban/shared";
import { kanbanCardUpdatePatch, useBoardWorkspaceState } from "./board-workspace-state";

function testBoard(id: string): KanbanBoard {
    return { id, name: id, createdAt: 1, updatedAt: 1 };
}

function testColumn(id: string, patch: Partial<KanbanColumn> = {}): KanbanColumn {
    return { id, boardId: "board-1", name: id, sortOrder: 1, createdAt: 1, updatedAt: 1, ...patch };
}

function testCard(id: string, patch: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id,
        boardId: "board-1",
        columnId: "todo",
        title: id,
        priority: "none",
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
        labelIds: [],
        subtasks: [],
        comments: [],
        ...patch
    };
}

function createApi(input: {
    boards?: KanbanBoard[];
    columns?: KanbanColumn[];
    cards?: KanbanCard[];
    labels?: KanbanLabel[];
} = {}): PreloadApi {
    const boards = input.boards ?? [testBoard("board-1")];
    const columns = input.columns ?? [testColumn("todo"), testColumn("done", { archivedAt: 2 })];
    const cards = input.cards ?? [testCard("active"), testCard("archived", { archivedAt: 2 })];
    const labels = input.labels ?? [];
    return {
        kanban: {
            listBoards: vi.fn(async () => boards),
            createBoard: vi.fn(async () => testBoard("created")),
            renameBoard: vi.fn(async ({ id, name }) => ({ ...testBoard(id), name })),
            deleteBoard: vi.fn(async () => undefined),
            listColumns: vi.fn(async () => columns),
            createColumn: vi.fn(async ({ boardId, name }) => testColumn("column-created", { boardId, name })),
            updateColumn: vi.fn(async ({ id, patch }) => testColumn(id, patch)),
            setCompletionColumn: vi.fn(async ({ boardId, columnId }) => ({ ...testBoard(boardId), completionColumnId: columnId })),
            reorderColumn: vi.fn(async ({ id }) => testColumn(id)),
            archiveColumn: vi.fn(async ({ id }) => testColumn(id, { archivedAt: 2 })),
            restoreColumn: vi.fn(async ({ id }) => testColumn(id)),
            listCards: vi.fn(async () => cards),
            createCard: vi.fn(async ({ boardId, columnId, title }) => testCard("created-card", { boardId, columnId, title })),
            updateCard: vi.fn(async ({ id, patch }) => testCard(id, patch as Partial<KanbanCard>)),
            deleteCard: vi.fn(async () => undefined),
            archiveCard: vi.fn(async ({ id }) => testCard(id, { archivedAt: 2 })),
            restoreCard: vi.fn(async ({ id }) => testCard(id)),
            reorderCard: vi.fn(async ({ id, toColumnId }) => testCard(id, { columnId: toColumnId })),
            listLabels: vi.fn(async () => labels),
            createLabel: vi.fn(async ({ boardId, name, color }) => ({ id: "label-created", boardId, name, color })),
            deleteLabel: vi.fn(async () => undefined),
            setCardLabels: vi.fn(async () => undefined),
            enableCardRecurrence: vi.fn(async ({ cardId, trigger, cycle }) => testCard(cardId, { recurrence: { seriesId: "series", trigger, cycle, status: "active" } })),
            updateCardRecurrence: vi.fn(async ({ cardId, trigger, cycle }) => testCard(cardId, { recurrence: { seriesId: "series", trigger, cycle, status: "active" } })),
            disableCardRecurrence: vi.fn(async ({ cardId }) => testCard(cardId)),
            generateDueRecurrences: vi.fn(async () => undefined),
            exportBoard: vi.fn(),
            importBoard: vi.fn(),
            onCardCommentsChanged: vi.fn(() => () => undefined)
        },
        agent: {
            listAvailable: vi.fn(async () => []),
            selectRepoPath: vi.fn(async () => null),
            validateRepoPath: vi.fn(async ({ path }) => ({ ok: false, path, message: "Not a git repo" })),
            startRun: vi.fn(async () => {
                throw new Error("No agent available");
            })
        },
        ai: {} as PreloadApi["ai"],
        system: {} as PreloadApi["system"]
    };
}

describe("Board Workspace State", () => {
    it("loads the selected Board workspace and derives visible Card collections", async () => {
        const api = createApi();
        const { result } = renderHook(() => useBoardWorkspaceState({ api }));

        await act(async () => {
            await result.current.loadBoards();
        });

        expect(result.current.selectedBoardId).toBe("board-1");
        expect(result.current.visibleColumns.map((column) => column.id)).toEqual(["todo"]);
        expect(result.current.activeCards.map((card) => card.id)).toEqual(["active"]);
        expect(result.current.archivedCards.map((card) => card.id)).toEqual(["archived"]);
    });

    it("creates a Card, refreshes Board data, and selects the new Card", async () => {
        const api = createApi();
        const { result } = renderHook(() => useBoardWorkspaceState({ api }));

        await act(async () => {
            await result.current.createCard("board-1", "todo", "New Card");
        });

        expect(api.kanban.createCard).toHaveBeenCalledWith({ boardId: "board-1", columnId: "todo", title: "New Card" });
        expect(api.kanban.listCards).toHaveBeenCalledWith({ boardId: "board-1", includeArchived: true });
        expect(result.current.selectedCardId).toBe("created-card");
    });

    it("preserves explicit null date patches for Card updates", () => {
        expect(kanbanCardUpdatePatch({ title: "Updated", startDate: null, endDate: null })).toEqual({
            title: "Updated",
            columnId: undefined,
            descriptionMarkdown: undefined,
            descriptionJson: undefined,
            descriptionText: undefined,
            gitRepositoryPath: undefined,
            priority: undefined,
            subtasks: undefined,
            comments: undefined,
            startDate: null,
            endDate: null
        });
    });
});
