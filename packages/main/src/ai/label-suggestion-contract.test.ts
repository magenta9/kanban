import type { AiLabelSuggestionInput, KanbanCard } from "@kanban/shared";
import { describe, expect, it } from "vitest";
import { buildLabelPromptInput } from "./label-suggestion-contract";

function testCard(input: Partial<KanbanCard> = {}): KanbanCard {
    return {
        id: "card-1",
        boardId: "board-1",
        columnId: "column-1",
        title: "Fix tag autocomplete",
        priority: "medium",
        sortOrder: 1000,
        createdAt: 1,
        updatedAt: 1,
        labelIds: ["label-1"],
        subtasks: [],
        comments: [],
        ...input
    };
}

function labelInput(input: Partial<AiLabelSuggestionInput> = {}): AiLabelSuggestionInput {
    return {
        maxSuggestions: 3,
        draft: "pro",
        context: {
            currentCard: testCard(),
            columnName: "Todo",
            boardLabels: [
                { id: "label-1", boardId: "board-1", name: "Product Ops", color: "#111827" },
                { id: "label-2", boardId: "board-1", name: "Project", color: "#2563eb" },
                { id: "label-3", boardId: "board-1", name: "Bug", color: "#dc2626" }
            ]
        },
        ...input
    };
}

describe("Label suggestion contract", () => {
    it("builds Label prompt input with draft-first candidates and compact Card context", () => {
        const prompt = buildLabelPromptInput(labelInput()) as {
            candidateLabels: string[];
            context: { currentCard: { title: string; labels: string[] }; columnName?: string };
        };

        expect(prompt.candidateLabels.slice(0, 2)).toEqual(["Product Ops", "Project"]);
        expect(prompt.context.columnName).toBe("Todo");
        expect(prompt.context.currentCard).toMatchObject({
            title: "Fix tag autocomplete",
            labels: ["Product Ops"]
        });
    });
});
