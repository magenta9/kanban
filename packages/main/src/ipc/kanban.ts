import type {
    CreateKanbanBoardInput,
    CreateKanbanCardInput,
    CreateKanbanColumnInput,
    CreateKanbanLabelInput,
    KanbanBoardExport,
    KanbanCardPatch,
    KanbanColumnPatch
} from "@kanban/shared";
import type { KanbanRepository } from "../db/repositories/kanban-repository";

export class KanbanHandlers {
    constructor(private readonly kanban: KanbanRepository) { }

    listBoards(): ReturnType<KanbanRepository["listBoards"]> {
        return this.kanban.listBoards();
    }

    createBoard(input: CreateKanbanBoardInput): ReturnType<KanbanRepository["createBoard"]> {
        return this.kanban.createBoard(input);
    }

    renameBoard(input: { id: string; name: string }): ReturnType<KanbanRepository["renameBoard"]> {
        return this.kanban.renameBoard(input);
    }

    deleteBoard(input: { id: string }): ReturnType<KanbanRepository["deleteBoard"]> {
        return this.kanban.deleteBoard(input);
    }

    listColumns(input: { boardId: string; includeArchived?: boolean }): ReturnType<KanbanRepository["listColumns"]> {
        return this.kanban.listColumns(input);
    }

    createColumn(input: CreateKanbanColumnInput): ReturnType<KanbanRepository["createColumn"]> {
        return this.kanban.createColumn(input);
    }

    updateColumn(input: { id: string; patch: Partial<KanbanColumnPatch> }): ReturnType<KanbanRepository["updateColumn"]> {
        return this.kanban.updateColumn(input);
    }

    reorderColumn(input: { id: string; beforeId?: string; afterId?: string }): ReturnType<KanbanRepository["reorderColumn"]> {
        return this.kanban.reorderColumn(input);
    }

    archiveColumn(input: { id: string }): ReturnType<KanbanRepository["archiveColumn"]> {
        return this.kanban.archiveColumn(input);
    }

    restoreColumn(input: { id: string }): ReturnType<KanbanRepository["restoreColumn"]> {
        return this.kanban.restoreColumn(input);
    }

    listCards(input: { boardId: string; includeArchived?: boolean }): ReturnType<KanbanRepository["listCards"]> {
        return this.kanban.listCards(input);
    }

    createCard(input: CreateKanbanCardInput): ReturnType<KanbanRepository["createCard"]> {
        return this.kanban.createCard(input);
    }

    updateCard(input: { id: string; patch: Partial<KanbanCardPatch> }): ReturnType<KanbanRepository["updateCard"]> {
        return this.kanban.updateCard(input);
    }

    deleteCard(input: { id: string }): ReturnType<KanbanRepository["deleteCard"]> {
        return this.kanban.deleteCard(input);
    }

    archiveCard(input: { id: string }): ReturnType<KanbanRepository["archiveCard"]> {
        return this.kanban.archiveCard(input);
    }

    restoreCard(input: { id: string }): ReturnType<KanbanRepository["restoreCard"]> {
        return this.kanban.restoreCard(input);
    }

    reorderCard(input: { id: string; toColumnId: string; beforeId?: string; afterId?: string }): ReturnType<KanbanRepository["reorderCard"]> {
        return this.kanban.reorderCard(input);
    }

    listLabels(input: { boardId: string }): ReturnType<KanbanRepository["listLabels"]> {
        return this.kanban.listLabels(input);
    }

    createLabel(input: CreateKanbanLabelInput): ReturnType<KanbanRepository["createLabel"]> {
        return this.kanban.createLabel(input);
    }

    deleteLabel(input: { id: string }): ReturnType<KanbanRepository["deleteLabel"]> {
        return this.kanban.deleteLabel(input);
    }

    setCardLabels(input: { cardId: string; labelIds: string[] }): ReturnType<KanbanRepository["setCardLabels"]> {
        return this.kanban.setCardLabels(input);
    }

    exportBoard(input: { boardId: string }): ReturnType<KanbanRepository["exportBoard"]> {
        return this.kanban.exportBoard(input);
    }

    importBoard(input: { payload: KanbanBoardExport }): ReturnType<KanbanRepository["importBoard"]> {
        return this.kanban.importBoard(input);
    }
}
