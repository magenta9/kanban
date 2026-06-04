import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KanbanCard, KanbanColumn } from "@kanban/shared";
import { chooseDraftCardColumnId, useDraftCardState } from "./draft-card-state";

function testColumn(id: string): KanbanColumn {
    return { id, boardId: "board", name: id, sortOrder: 1, createdAt: 1, updatedAt: 1 };
}

function testCard(patch: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card",
        boardId: "board",
        columnId: "todo",
        title: "Card",
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

afterEach(() => {
    vi.restoreAllMocks();
});

describe("Draft Card state", () => {
    it("chooses the selected Card Column before active Draft Card and fallback Columns", () => {
        const visibleColumns = [testColumn("todo"), testColumn("doing")];

        expect(chooseDraftCardColumnId({ selectedCard: testCard({ columnId: "doing" }), visibleColumns, activeDraftColumnId: "todo" })).toBe("doing");
        expect(chooseDraftCardColumnId({ selectedCard: testCard({ columnId: "archived" }), visibleColumns, activeDraftColumnId: "todo" })).toBe("todo");
        expect(chooseDraftCardColumnId({ visibleColumns, activeDraftColumnId: "missing" })).toBe("todo");
    });

    it("opens, types, closes, and submits a Draft Card through one interface", async () => {
        const create = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useDraftCardState());

        act(() => result.current.composerForColumn("todo").openComposer());
        expect(result.current.composerForColumn("todo").open).toBe(true);

        act(() => result.current.composerForColumn("todo").setTitle("  New card  "));
        expect(result.current.composerForColumn("todo").title).toBe("  New card  ");

        await act(async () => {
            await expect(result.current.composerForColumn("todo").submit(create)).resolves.toBe(true);
        });
        expect(create).toHaveBeenCalledWith({ columnId: "todo", title: "New card" });
        expect(result.current.draftCard).toBeNull();

        act(() => result.current.composerForColumn("doing").openComposer());
        act(() => result.current.close());
        expect(result.current.composerForColumn("doing").open).toBe(false);
    });

    it("opens a Draft Card from keyboard shortcut target selection", () => {
        const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
            callback(0);
            return 1;
        });
        const { result } = renderHook(() => useDraftCardState());
        const visibleColumns = [testColumn("todo"), testColumn("doing")];

        act(() => {
            expect(result.current.openFromShortcut({ selectedCard: testCard({ columnId: "doing" }), visibleColumns })).toBe("doing");
        });

        expect(result.current.activeColumnId).toBe("doing");
        expect(requestAnimationFrame).toHaveBeenCalled();
    });
});
