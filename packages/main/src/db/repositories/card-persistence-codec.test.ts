import { describe, expect, it } from "vitest";
import { cardToInsertParams, rowToCard, type CardRow } from "./card-persistence-codec";

function cardRow(input: Partial<CardRow> = {}): CardRow {
    return {
        id: "card-1",
        board_id: "board-1",
        column_id: "column-1",
        title: "Plan release",
        description_markdown: "## Scope\n\n- Ship notes",
        description_json: null,
        description_text: "Scope\nShip notes",
        subtasks_json: "[]",
        comments_json: "[]",
        priority: "medium",
        due_date: null,
        start_date: null,
        end_date: null,
        sort_order: 1000,
        created_at: 1,
        updated_at: 2,
        archived_at: null,
        ...input
    };
}

describe("Card persistence codec", () => {
    it("decodes Card rows with safe JSON fallbacks", () => {
        const card = rowToCard(cardRow({
            description_json: "{broken",
            subtasks_json: JSON.stringify([
                { id: "subtask-1", title: "Write notes", completed: false, createdAt: 1, updatedAt: 1 },
                { id: "invalid" }
            ]),
            comments_json: "not-json",
            due_date: 10,
            start_date: 10,
            end_date: 10
        }));

        expect(card).toMatchObject({
            id: "card-1",
            boardId: "board-1",
            columnId: "column-1",
            descriptionJson: undefined,
            comments: [],
            dueDate: 10,
            startDate: 10,
            endDate: 10,
            labelIds: []
        });
        expect(card.subtasks).toEqual([{ id: "subtask-1", title: "Write notes", completed: false, createdAt: 1, updatedAt: 1 }]);
    });

    it("encodes Card insert params with text and legacy date range compatibility", () => {
        const params = cardToInsertParams({
            id: "card-1",
            boardId: "board-1",
            columnId: "column-1",
            title: "Plan release",
            descriptionMarkdown: "## Scope\n\n- Ship notes",
            priority: "medium",
            dueDate: 10.8,
            sortOrder: 1000,
            createdAt: 1,
            updatedAt: 2,
            labelIds: [],
            subtasks: [{ id: "subtask-1", title: "Write notes", completed: false, createdAt: 1, updatedAt: 1 }],
            comments: [{ id: "comment-1", body: "Looks ready", createdAt: 1, updatedAt: 1 }]
        });

        expect(params).toMatchObject({
            descriptionMarkdown: "## Scope\n\n- Ship notes",
            descriptionText: "Scope\nShip notes",
            dueDate: 10,
            startDate: 10,
            endDate: 10,
            archivedAt: null
        });
        expect(JSON.parse(params.subtasksJson)).toEqual([{ id: "subtask-1", title: "Write notes", completed: false, createdAt: 1, updatedAt: 1 }]);
        expect(JSON.parse(params.commentsJson)).toEqual([{ id: "comment-1", body: "Looks ready", createdAt: 1, updatedAt: 1 }]);
    });
});
