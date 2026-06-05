import type {
    KanbanBoard,
    KanbanBoardExport,
    KanbanCard,
    KanbanCardLabel,
    KanbanColumn,
    KanbanLabel,
    KanbanRecurrenceOccurrence,
    KanbanRecurrenceSeries
} from "@kanban/shared";
import { randomUUID } from "node:crypto";
import { remapTemplateLabels } from "./recurrence-template";

export interface BoardImportPlan {
    board: KanbanBoard;
    columns: KanbanColumn[];
    labels: KanbanLabel[];
    cards: KanbanCard[];
    cardLabels: KanbanCardLabel[];
    recurrenceSeries: KanbanRecurrenceSeries[];
    recurrenceOccurrences: KanbanRecurrenceOccurrence[];
}

export function createBoardImportPlan(input: {
    payload: KanbanBoardExport;
    now: number;
    newId?: () => string;
}): BoardImportPlan {
    if (input.payload.version !== 1) {
        throw new Error("Unsupported Kanban export version.");
    }

    const newId = input.newId ?? randomUUID;
    const boardId = newId();
    const columnIds = new Map(input.payload.columns.map((column) => [column.id, newId()]));
    const cardIds = new Map(input.payload.cards.map((card) => [card.id, newId()]));
    const labelIds = new Map(input.payload.labels.map((label) => [label.id, newId()]));
    const seriesIds = new Map((input.payload.recurrenceSeries ?? []).map((series) => [series.id, newId()]));

    const board: KanbanBoard = {
        id: boardId,
        name: `${input.payload.board.name} Copy`,
        description: input.payload.board.description,
        completionColumnId: input.payload.board.completionColumnId ? columnIds.get(input.payload.board.completionColumnId) : undefined,
        createdAt: input.now,
        updatedAt: input.now,
        archivedAt: input.payload.board.archivedAt
    };

    return {
        board,
        columns: input.payload.columns.map((column) => ({ ...column, id: columnIds.get(column.id) ?? newId(), boardId })),
        labels: input.payload.labels.map((label) => ({ ...label, id: labelIds.get(label.id) ?? newId(), boardId })),
        cards: input.payload.cards.flatMap((card) => {
            const nextColumnId = columnIds.get(card.columnId);
            if (!nextColumnId) return [];
            return [{ ...card, id: cardIds.get(card.id) ?? newId(), boardId, columnId: nextColumnId, labelIds: [] }];
        }),
        cardLabels: input.payload.cardLabels.flatMap((relation) => {
            const cardId = cardIds.get(relation.cardId);
            const labelId = labelIds.get(relation.labelId);
            return cardId && labelId ? [{ cardId, labelId }] : [];
        }),
        recurrenceSeries: (input.payload.recurrenceSeries ?? []).flatMap((series) => {
            const id = seriesIds.get(series.id);
            if (!id) return [];
            return [{
                ...series,
                id,
                boardId,
                activeBatonCardId: series.activeBatonCardId ? cardIds.get(series.activeBatonCardId) : undefined,
                templateJson: remapTemplateLabels(series.templateJson, labelIds),
                createdAt: input.now,
                updatedAt: input.now
            }];
        }),
        recurrenceOccurrences: (input.payload.recurrenceOccurrences ?? []).flatMap((occurrence) => {
            const seriesId = seriesIds.get(occurrence.seriesId);
            const cardId = cardIds.get(occurrence.cardId);
            return seriesId && cardId ? [{ ...occurrence, seriesId, cardId, createdAt: input.now }] : [];
        })
    };
}
