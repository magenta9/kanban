import { describe, expect, it } from "vitest";
import type { KanbanCard } from "@kanban/shared";
import { occurrenceDateRange, parseRecurrenceTemplate, remapTemplateLabels, serializeRecurrenceTemplate, templateFromCard } from "./recurrence-template";

function testCard(patch: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card-1",
        boardId: "board-1",
        columnId: "todo",
        title: "Review notes",
        priority: "medium",
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
        labelIds: ["label-1"],
        subtasks: [{ id: "subtask-1", title: "Read", completed: true, createdAt: 1, updatedAt: 1 }],
        comments: [{ id: "comment-1", body: "Do not carry", createdAt: 1, updatedAt: 1 }],
        ...patch
    };
}

describe("Recurrence Template", () => {
    it("captures work definition from a Recurring Card without carrying execution state", () => {
        const template = templateFromCard(testCard());

        expect(template).toMatchObject({
            title: "Review notes",
            priority: "medium",
            labelIds: ["label-1"],
            subtasks: [{ id: "subtask-1", title: "Read", completed: false }]
        });
        expect(template).not.toHaveProperty("comments");
    });

    it("parses stored templates defensively and resets Subtask completion", () => {
        const stored = serializeRecurrenceTemplate(templateFromCard(testCard()));

        expect(parseRecurrenceTemplate(stored)?.subtasks[0]).toMatchObject({ title: "Read", completed: false });
        expect(parseRecurrenceTemplate("{bad json")).toBeUndefined();
        expect(parseRecurrenceTemplate(JSON.stringify({ title: "Missing priority" }))).toBeUndefined();
    });

    it("remaps Label ids when importing a Board copy", () => {
        const stored = serializeRecurrenceTemplate({
            ...templateFromCard(testCard({ labelIds: ["old-1", "old-2"] }))
        });

        expect(parseRecurrenceTemplate(remapTemplateLabels(stored, new Map([["old-2", "new-2"]])))).toMatchObject({
            labelIds: ["new-2"]
        });
    });

    it("preserves Date Range span for generated Occurrences", () => {
        const source = testCard({ startDate: date(2026, 0, 1), endDate: date(2026, 0, 3) });

        expect(occurrenceDateRange(source, date(2026, 1, 1))).toEqual({
            startDate: date(2026, 1, 1),
            endDate: date(2026, 1, 3)
        });
        expect(occurrenceDateRange(testCard(), date(2026, 1, 1))).toEqual({
            startDate: date(2026, 1, 1),
            endDate: date(2026, 1, 1)
        });
    });
});

function date(year: number, month: number, day: number): number {
    return new Date(year, month, day).getTime();
}
