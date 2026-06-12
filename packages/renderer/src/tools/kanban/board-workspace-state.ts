import { useCallback, useMemo, useState } from "react";
import type { KanbanBoard, KanbanCard, KanbanCardPatch, KanbanColumn, KanbanColumnPatch, KanbanLabel, KanbanRecurrenceCycle, KanbanRecurrenceTrigger, PreloadApi } from "@kanban/shared";
import { stableLabelColor } from "./kanban-helpers";

export interface BoardWorkspaceState {
    boards: KanbanBoard[];
    selectedBoardId: string;
    selectedBoard?: KanbanBoard;
    columns: KanbanColumn[];
    cards: KanbanCard[];
    labels: KanbanLabel[];
    selectedCardId: string;
    selectedCard?: KanbanCard;
    visibleColumns: KanbanColumn[];
    activeCards: KanbanCard[];
    archivedCards: KanbanCard[];
    loading: boolean;
    error: string | null;
    loadBoards: (input?: { preferBoardId?: string }) => Promise<string>;
    reloadBoardData: (boardId: string) => Promise<void>;
    selectBoard: (boardId: string) => Promise<void>;
    openCard: (cardId: string) => void;
    clearSelectedCard: () => void;
    createBoard: (name: string) => Promise<KanbanBoard>;
    renameBoard: (boardId: string, name: string) => Promise<void>;
    deleteBoard: (boardId: string) => Promise<void>;
    createColumn: (boardId: string, name: string) => Promise<void>;
    updateColumn: (column: KanbanColumn, patch: Partial<KanbanColumnPatch>) => Promise<void>;
    setCompletionColumn: (column: KanbanColumn) => Promise<void>;
    archiveColumn: (column: KanbanColumn) => Promise<void>;
    createCard: (boardId: string, columnId: string, title: string) => Promise<KanbanCard>;
    updateCard: (cardId: string, patch: Partial<KanbanCardPatch>) => Promise<void>;
    saveCardRecurrence: (cardId: string, trigger: KanbanRecurrenceTrigger, cycle: KanbanRecurrenceCycle) => Promise<void>;
    disableCardRecurrence: (cardId: string) => Promise<void>;
    archiveCard: (cardId: string) => Promise<void>;
    restoreCard: (cardId: string) => Promise<void>;
    deleteCard: (cardId: string) => Promise<void>;
    createAndAttachLabel: (card: KanbanCard, name: string) => Promise<void>;
    toggleCardLabel: (card: KanbanCard, labelId: string) => Promise<void>;
    reorderColumn: (input: { id: string; beforeId?: string; afterId?: string }) => Promise<void>;
    reorderCard: (input: { id: string; toColumnId: string; beforeId?: string; afterId?: string }) => Promise<void>;
}

export function kanbanCardUpdatePatch(patch: Partial<KanbanCardPatch>): Partial<KanbanCardPatch> {
    const nextPatch: Partial<KanbanCardPatch> = {
        title: patch.title,
        columnId: patch.columnId,
        descriptionMarkdown: patch.descriptionMarkdown,
        descriptionJson: patch.descriptionJson,
        descriptionText: patch.descriptionText,
        gitRepositoryPath: patch.gitRepositoryPath,
        priority: patch.priority,
        subtasks: patch.subtasks,
        comments: patch.comments
    };
    if (Object.prototype.hasOwnProperty.call(patch, "dueDate")) nextPatch.dueDate = patch.dueDate ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "startDate")) nextPatch.startDate = patch.startDate ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "endDate")) nextPatch.endDate = patch.endDate ?? null;
    return nextPatch;
}

export function useBoardWorkspaceState({ api }: { api: PreloadApi }): BoardWorkspaceState {
    const [boards, setBoards] = useState<KanbanBoard[]>([]);
    const [selectedBoardId, setSelectedBoardId] = useState("");
    const [columns, setColumns] = useState<KanbanColumn[]>([]);
    const [cards, setCards] = useState<KanbanCard[]>([]);
    const [labels, setLabels] = useState<KanbanLabel[]>([]);
    const [selectedCardId, setSelectedCardId] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reloadBoardData = useCallback(async (boardId: string): Promise<void> => {
        const [nextColumns, nextCards, nextLabels] = await Promise.all([
            api.kanban.listColumns({ boardId, includeArchived: true }),
            api.kanban.listCards({ boardId, includeArchived: true }),
            api.kanban.listLabels({ boardId })
        ]);
        setColumns(nextColumns);
        setCards(nextCards);
        setLabels(nextLabels);
    }, [api]);

    const loadBoards = useCallback(async (input: { preferBoardId?: string } = {}): Promise<string> => {
        try {
            setLoading(true);
            const nextBoards = await api.kanban.listBoards();
            setBoards(nextBoards);
            const preferredBoardId = input.preferBoardId ?? selectedBoardId;
            const nextSelectedId = preferredBoardId && nextBoards.some((board) => board.id === preferredBoardId)
                ? preferredBoardId
                : nextBoards[0]?.id ?? "";
            setSelectedBoardId(nextSelectedId);
            if (nextSelectedId) {
                await reloadBoardData(nextSelectedId);
            } else {
                setColumns([]);
                setCards([]);
                setLabels([]);
            }
            setError(null);
            return nextSelectedId;
        } catch (caught) {
            setError(errorMessage(caught));
            return "";
        } finally {
            setLoading(false);
        }
    }, [api, reloadBoardData, selectedBoardId]);

    const selectBoard = useCallback(async (boardId: string): Promise<void> => {
        setSelectedBoardId(boardId);
        setSelectedCardId("");
        await reloadBoardData(boardId);
    }, [reloadBoardData]);

    const refreshSelectedBoard = useCallback(async (): Promise<void> => {
        if (selectedBoardId) await reloadBoardData(selectedBoardId);
    }, [reloadBoardData, selectedBoardId]);

    const createBoard = useCallback(async (name: string): Promise<KanbanBoard> => {
        const board = await api.kanban.createBoard({ name });
        await loadBoards({ preferBoardId: board.id });
        return board;
    }, [api, loadBoards]);

    const renameBoard = useCallback(async (boardId: string, name: string): Promise<void> => {
        await api.kanban.renameBoard({ id: boardId, name });
        await loadBoards({ preferBoardId: boardId });
    }, [api, loadBoards]);

    const deleteBoard = useCallback(async (boardId: string): Promise<void> => {
        await api.kanban.deleteBoard({ id: boardId });
        setSelectedCardId("");
        await loadBoards();
    }, [api, loadBoards]);

    const createColumn = useCallback(async (boardId: string, name: string): Promise<void> => {
        await api.kanban.createColumn({ boardId, name });
        await reloadBoardData(boardId);
    }, [api, reloadBoardData]);

    const updateColumn = useCallback(async (column: KanbanColumn, patch: Partial<KanbanColumnPatch>): Promise<void> => {
        await api.kanban.updateColumn({ id: column.id, patch });
        await reloadBoardData(column.boardId);
    }, [api, reloadBoardData]);

    const setCompletionColumn = useCallback(async (column: KanbanColumn): Promise<void> => {
        await api.kanban.setCompletionColumn({ boardId: column.boardId, columnId: column.id });
        await loadBoards({ preferBoardId: column.boardId });
    }, [api, loadBoards]);

    const archiveColumn = useCallback(async (column: KanbanColumn): Promise<void> => {
        try {
            await api.kanban.archiveColumn({ id: column.id });
            await reloadBoardData(column.boardId);
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
            throw caught;
        }
    }, [api, reloadBoardData]);

    const createCard = useCallback(async (boardId: string, columnId: string, title: string): Promise<KanbanCard> => {
        try {
            const card = await api.kanban.createCard({ boardId, columnId, title });
            await reloadBoardData(boardId);
            setSelectedCardId(card.id);
            setError(null);
            return card;
        } catch (caught) {
            setError(errorMessage(caught));
            throw caught;
        }
    }, [api, reloadBoardData]);

    const updateCard = useCallback(async (cardId: string, patch: Partial<KanbanCardPatch>): Promise<void> => {
        if (!selectedBoardId) return;
        await api.kanban.updateCard({ id: cardId, patch: kanbanCardUpdatePatch(patch) });
        await reloadBoardData(selectedBoardId);
        setError(null);
    }, [api, reloadBoardData, selectedBoardId]);

    const saveCardRecurrence = useCallback(async (cardId: string, trigger: KanbanRecurrenceTrigger, cycle: KanbanRecurrenceCycle): Promise<void> => {
        if (!selectedBoardId) return;
        const card = cards.find((item) => item.id === cardId);
        if (!card) return;
        if (card.recurrence) {
            await api.kanban.updateCardRecurrence({ cardId, trigger, cycle });
        } else {
            await api.kanban.enableCardRecurrence({ cardId, trigger, cycle });
        }
        await reloadBoardData(selectedBoardId);
        setError(null);
    }, [api, cards, reloadBoardData, selectedBoardId]);

    const disableCardRecurrence = useCallback(async (cardId: string): Promise<void> => {
        if (!selectedBoardId) return;
        await api.kanban.disableCardRecurrence({ cardId });
        await reloadBoardData(selectedBoardId);
        setError(null);
    }, [api, reloadBoardData, selectedBoardId]);

    const archiveCard = useCallback(async (cardId: string): Promise<void> => {
        if (!selectedBoardId) return;
        await api.kanban.archiveCard({ id: cardId });
        setSelectedCardId("");
        await reloadBoardData(selectedBoardId);
    }, [api, reloadBoardData, selectedBoardId]);

    const restoreCard = useCallback(async (cardId: string): Promise<void> => {
        if (!selectedBoardId) return;
        await api.kanban.restoreCard({ id: cardId });
        await reloadBoardData(selectedBoardId);
    }, [api, reloadBoardData, selectedBoardId]);

    const deleteCard = useCallback(async (cardId: string): Promise<void> => {
        if (!selectedBoardId) return;
        await api.kanban.deleteCard({ id: cardId });
        setSelectedCardId("");
        await reloadBoardData(selectedBoardId);
    }, [api, reloadBoardData, selectedBoardId]);

    const createAndAttachLabel = useCallback(async (card: KanbanCard, name: string): Promise<void> => {
        if (!selectedBoardId) return;
        const label = await api.kanban.createLabel({ boardId: selectedBoardId, name, color: stableLabelColor(selectedBoardId, name) });
        await api.kanban.setCardLabels({ cardId: card.id, labelIds: [...card.labelIds, label.id] });
        await reloadBoardData(selectedBoardId);
    }, [api, reloadBoardData, selectedBoardId]);

    const toggleCardLabel = useCallback(async (card: KanbanCard, labelId: string): Promise<void> => {
        const next = card.labelIds.includes(labelId) ? card.labelIds.filter((id) => id !== labelId) : [...card.labelIds, labelId];
        await api.kanban.setCardLabels({ cardId: card.id, labelIds: next });
        await refreshSelectedBoard();
    }, [api, refreshSelectedBoard]);

    const reorderColumn = useCallback(async (input: { id: string; beforeId?: string; afterId?: string }): Promise<void> => {
        await api.kanban.reorderColumn(input);
        await refreshSelectedBoard();
    }, [api, refreshSelectedBoard]);

    const reorderCard = useCallback(async (input: { id: string; toColumnId: string; beforeId?: string; afterId?: string }): Promise<void> => {
        await api.kanban.reorderCard(input);
        await refreshSelectedBoard();
    }, [api, refreshSelectedBoard]);

    const selectedBoard = boards.find((board) => board.id === selectedBoardId);
    const selectedCard = cards.find((card) => card.id === selectedCardId);
    const visibleColumns = useMemo(
        () => columns.filter((column) => !column.archivedAt).sort((left, right) => left.sortOrder - right.sortOrder),
        [columns]
    );
    const activeCards = useMemo(() => cards.filter((card) => !card.archivedAt), [cards]);
    const archivedCards = useMemo(() => cards.filter((card) => card.archivedAt), [cards]);

    return {
        boards,
        selectedBoardId,
        selectedBoard,
        columns,
        cards,
        labels,
        selectedCardId,
        selectedCard,
        visibleColumns,
        activeCards,
        archivedCards,
        loading,
        error,
        loadBoards,
        reloadBoardData,
        selectBoard,
        openCard: setSelectedCardId,
        clearSelectedCard: () => setSelectedCardId(""),
        createBoard,
        renameBoard,
        deleteBoard,
        createColumn,
        updateColumn,
        setCompletionColumn,
        archiveColumn,
        createCard,
        updateCard,
        saveCardRecurrence,
        disableCardRecurrence,
        archiveCard,
        restoreCard,
        deleteCard,
        createAndAttachLabel,
        toggleCardLabel,
        reorderColumn,
        reorderCard
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
