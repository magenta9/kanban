import type { KanbanBoardExport } from "@kanban/shared";
import { describe, expect, it } from "vitest";
import { createBoardImportPlan } from "./board-import-plan";
import { parseRecurrenceTemplate, serializeRecurrenceTemplate } from "./recurrence-template";

function idFactory(): () => string {
    let index = 0;
    return () => `new-${++index}`;
}

function exportPayload(): KanbanBoardExport {
    return {
        version: 1,
        exportedAt: 100,
        board: {
            id: "board-old",
            name: "Launch",
            completionColumnId: "column-done",
            createdAt: 1,
            updatedAt: 2
        },
        columns: [
            { id: "column-todo", boardId: "board-old", name: "Todo", sortOrder: 1000, createdAt: 1, updatedAt: 1 },
            { id: "column-done", boardId: "board-old", name: "Done", sortOrder: 2000, createdAt: 1, updatedAt: 1 }
        ],
        cards: [
            {
                id: "card-1",
                boardId: "board-old",
                columnId: "column-todo",
                title: "Draft release",
                priority: "medium",
                sortOrder: 1000,
                createdAt: 1,
                updatedAt: 1,
                labelIds: ["label-1"],
                subtasks: [],
                comments: []
            }
        ],
        labels: [
            { id: "label-1", boardId: "board-old", name: "UI", color: "#2563eb" }
        ],
        cardLabels: [
            { cardId: "card-1", labelId: "label-1" }
        ],
        recurrenceSeries: [
            {
                id: "series-1",
                boardId: "board-old",
                trigger: "completion",
                cycle: "daily",
                activeBatonCardId: "card-1",
                templateJson: serializeRecurrenceTemplate({
                    title: "Draft release",
                    descriptionMarkdown: undefined,
                    descriptionJson: undefined,
                    descriptionText: undefined,
                    priority: "medium",
                    labelIds: ["label-1", "missing-label"],
                    subtasks: []
                }),
                status: "active",
                lastOccurrenceDate: 10,
                anchorDay: 1,
                createdAt: 1,
                updatedAt: 1
            }
        ],
        recurrenceOccurrences: [
            { seriesId: "series-1", cardId: "card-1", occurrenceDate: 10, createdAt: 1 }
        ]
    };
}

describe("createBoardImportPlan", () => {
    it("remaps exported Board identities into a copy import plan", () => {
        const plan = createBoardImportPlan({ payload: exportPayload(), now: 999, newId: idFactory() });

        expect(plan.board).toMatchObject({
            id: "new-1",
            name: "Launch Copy",
            completionColumnId: "new-3",
            createdAt: 999,
            updatedAt: 999
        });
        expect(plan.columns.map((column) => [column.id, column.boardId])).toEqual([["new-2", "new-1"], ["new-3", "new-1"]]);
        expect(plan.labels).toEqual([{ id: "new-5", boardId: "new-1", name: "UI", color: "#2563eb" }]);
        expect(plan.cards[0]).toMatchObject({ id: "new-4", boardId: "new-1", columnId: "new-2", labelIds: [] });
        expect(plan.cardLabels).toEqual([{ cardId: "new-4", labelId: "new-5" }]);
        expect(plan.recurrenceSeries[0]).toMatchObject({
            id: "new-6",
            boardId: "new-1",
            activeBatonCardId: "new-4",
            createdAt: 999,
            updatedAt: 999
        });
        expect(parseRecurrenceTemplate(plan.recurrenceSeries[0]!.templateJson)?.labelIds).toEqual(["new-5"]);
        expect(plan.recurrenceOccurrences).toEqual([{ seriesId: "new-6", cardId: "new-4", occurrenceDate: 10, createdAt: 999 }]);
    });

    it("rejects unsupported export versions", () => {
        const payload = { ...exportPayload(), version: 2 as 1 };

        expect(() => createBoardImportPlan({ payload, now: 1, newId: idFactory() })).toThrow("Unsupported Kanban export version.");
    });
});
