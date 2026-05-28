import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KanbanCard } from "@kanban/shared";
import { cardEditPatch, cardEditSnapshotFromCard, useCardEditingState } from "./card-edit-state";

function testCard(patch: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card-1",
        boardId: "board-1",
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
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("Card Editing State", () => {
    it("builds editable snapshots with legacy dueDate compatibility", () => {
        const snapshot = cardEditSnapshotFromCard(testCard({ dueDate: 123, descriptionText: "Plain description" }));

        expect(snapshot).toMatchObject({
            startDate: 123,
            endDate: 123,
            descriptionJson: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: "Plain description" }] }]
            },
            descriptionText: "Plain description"
        });
    });

    it("creates save patches from the editable snapshot", () => {
        const snapshot = cardEditSnapshotFromCard(testCard({ title: "Original" }));

        expect(cardEditPatch({ ...snapshot, title: "Updated" })).toMatchObject({
            title: "Updated",
            columnId: "todo",
            priority: "none",
            startDate: null,
            endDate: null,
            descriptionMarkdown: undefined,
            descriptionJson: undefined,
            descriptionText: "",
            subtasks: [],
            comments: []
        });
    });

    it("keeps rich text JSON as the editable description source when available", () => {
        const descriptionJson = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] }] };
        const snapshot = cardEditSnapshotFromCard(testCard({
            descriptionMarkdown: "## Stale markdown",
            descriptionJson,
            descriptionText: "Plan"
        }));

        expect(snapshot.descriptionJson).toEqual(descriptionJson);
        expect(cardEditPatch({ ...snapshot, descriptionMarkdown: "" })).toMatchObject({
            descriptionMarkdown: "",
            descriptionJson,
            descriptionText: "Plan"
        });
    });

    it("debounces save through the hook interface", () => {
        vi.useFakeTimers();
        const onSave = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useCardEditingState({ card: testCard(), onSave, saveDelayMs: 25 }));

        act(() => result.current.setTitle("Updated"));
        expect(onSave).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(24));
        expect(onSave).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(1));
        expect(onSave).toHaveBeenCalledWith("card-1", expect.objectContaining({ title: "Updated" }));
    });

    it("resets state when the active Card changes", () => {
        vi.useFakeTimers();
        const onSave = vi.fn().mockResolvedValue(undefined);
        const firstCard = testCard({ id: "card-1", title: "First" });
        const secondCard = testCard({ id: "card-2", title: "Second" });
        const { result, rerender } = renderHook(({ card }) => useCardEditingState({ card, onSave, saveDelayMs: 25 }), {
            initialProps: { card: firstCard }
        });

        act(() => result.current.setTitle("Dirty first"));
        rerender({ card: secondCard });

        expect(result.current.title).toBe("Second");
        act(() => vi.advanceTimersByTime(25));
        expect(onSave).not.toHaveBeenCalled();
    });

    it("mutates Subtasks through the hook interface", () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useCardEditingState({
            card: testCard({
                subtasks: [
                    { id: "subtask-1", title: "First", completed: false, createdAt: 1, updatedAt: 1 },
                    { id: "subtask-2", title: "Second", completed: false, createdAt: 1, updatedAt: 1 }
                ]
            }),
            onSave,
            saveDelayMs: 25
        }));

        act(() => result.current.updateSubtask("subtask-1", { completed: true }));
        expect(result.current.subtasks[0]).toMatchObject({ id: "subtask-1", completed: true });

        act(() => result.current.reorderSubtask("subtask-1", "subtask-2"));
        expect(result.current.subtasks.map((subtask) => subtask.id)).toEqual(["subtask-2", "subtask-1"]);

        act(() => result.current.deleteSubtask("subtask-2"));
        expect(result.current.subtasks.map((subtask) => subtask.id)).toEqual(["subtask-1"]);

        act(() => {
            expect(result.current.addSubtask("  Third  ")).toBe(true);
        });
        expect(result.current.subtasks.map((subtask) => subtask.title)).toEqual(["First", "Third"]);
    });

    it("mutates Comments through the hook interface", () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useCardEditingState({
            card: testCard({
                comments: [{ id: "comment-1", body: "Existing", createdAt: 1, updatedAt: 1 }]
            }),
            onSave,
            saveDelayMs: 25
        }));

        act(() => {
            expect(result.current.addComment("  Follow up  ")).toBe(true);
            expect(result.current.addComment("   ")).toBe(false);
        });
        expect(result.current.comments.map((comment) => comment.body)).toEqual(["Existing", "Follow up"]);

        act(() => result.current.deleteComment("comment-1"));
        expect(result.current.comments.map((comment) => comment.body)).toEqual(["Follow up"]);
    });
});
