import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import {
    closestCenter,
    DragOverlay,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent
} from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { Editor, JSONContent } from "@tiptap/react";
import ReactMarkdown from "react-markdown";
import { markdownToPlainText } from "@kanban/shared";
import type { AiLabelSuggestion, AiSettingsState, AiSuggestionCardContext, AiTestConnectionResult, AiTextSuggestionField, KanbanBoard, KanbanCard, KanbanCardPatch, KanbanColumn, KanbanComment, KanbanLabel, KanbanPriority, KanbanRecurrenceCycle, KanbanRecurrenceTrigger, KanbanRichTextDocument, KanbanSubtask } from "@kanban/shared";
import {
    Archive,
    AlertTriangle,
    ArrowRight,
    CalendarDays,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CircleHelp,
    Command,
    Columns3,
    Flag,
    KanbanSquare,
    List,
    Menu,
    MoreHorizontal,
    Pencil,
    Plus,
    Repeat2,
    RotateCcw,
    Tag,
    Trash2,
    X
} from "lucide-react";
import { getApi } from "../../api";
import { IconButton, SegmentedControl } from "../../components/tool-layout";
import {
    applyRichTextListContinuation,
    applyRichTextListIndentation,
    draftCardsForAiContext,
    findRichTextMarkdownLinkSuffix,
    formatDateRange,
    isEditableShortcutTarget,
    isMarkdownSubmitShortcut,
    isRichTextListActive,
    isRichTextListContinuationShortcut,
    isRichTextListIndentShortcut,
    isRichTextSubmitShortcut,
    keyboardShortcutFromEvent,
    normalizeDateRange,
    recurrenceSummary,
    relatedCardsForAiContext,
    resolveRichTextLinkPaste,
    shouldApplyInlineCompletion,
    shouldRequestInlineCompletion,
    shouldSyncRichTextEditorContent,
    stableLabelColor,
    suggestBoardLabelsByPrefix
} from "./kanban-helpers";

type ViewMode = "kanban" | "list" | "archive";

type RichTextSubmitHandler = (json: KanbanRichTextDocument, text: string) => void;

interface RichTextLinkInsertTarget {
    label: string;
    url: string;
    selectLabel: boolean;
}

interface SelectOption {
    value: string;
    label: string;
}

interface TextDialogState {
    title: string;
    label: string;
    initialValue: string;
    confirmLabel: string;
    onSubmit: (value: string) => Promise<void>;
}

interface ConfirmDialogState {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
}

interface CardDropTarget {
    columnId: string;
    index: number;
    beforeId?: string;
    afterId?: string;
}

interface CursorText {
    before: string;
    after: string;
}

const priorities: KanbanPriority[] = ["none", "low", "medium", "high", "urgent"];
const recurrenceCycles: KanbanRecurrenceCycle[] = ["daily", "weekly", "monthly"];
const recurrenceTriggers: KanbanRecurrenceTrigger[] = ["fixed", "completion"];
const weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const keyboardShortcutGroups = [
    {
        title: "Boards",
        shortcuts: [
            { keys: ["Cmd", "1...9"], title: "Switch board", description: "Open the board in the matching position from the sidebar list." },
            { keys: ["Cmd", "B"], title: "Toggle sidebar", description: "Collapse or expand the board list." }
        ]
    },
    {
        title: "Views",
        shortcuts: [
            { keys: ["Cmd", "K"], title: "Kanban view", description: "Show cards grouped in board columns." },
            { keys: ["Cmd", "L"], title: "List view", description: "Show active cards in a compact list." },
            { keys: ["Cmd", "A"], title: "Archive view", description: "Show archived cards for restore or cleanup." }
        ]
    },
    {
        title: "Create",
        shortcuts: [
            { keys: ["Cmd", "N"], title: "New card", description: "Open a card composer in the current card's column, current composer, or first column." },
            { keys: ["Cmd", "Shift", "N"], title: "New column", description: "Open the new column dialog for the selected board." }
        ]
    },
    {
        title: "System",
        shortcuts: [
            { keys: ["Cmd", "/"], title: "Keyboard shortcuts", description: "Open this help panel." },
            { keys: ["Esc"], title: "Close", description: "Close the top help panel, dialog, or card details panel." }
        ]
    }
] as const;
const helpGuides = [
    "Switch boards with Cmd+1...9 using the order shown in the sidebar.",
    "Switch between Kanban, List, and Archive views with Cmd+K, Cmd+L, and Cmd+A.",
    "Create cards and columns from the keyboard while keeping destructive actions on explicit buttons.",
    "Edit card details in the side panel; changes save automatically after a short pause.",
    "Reorder cards, columns, and subtasks by dragging them, including keyboard drag support from the focused handle."
] as const;

export function KanbanPage(): JSX.Element {
    const [boards, setBoards] = useState<KanbanBoard[]>([]);
    const [selectedBoardId, setSelectedBoardId] = useState<string>("");
    const [columns, setColumns] = useState<KanbanColumn[]>([]);
    const [cards, setCards] = useState<KanbanCard[]>([]);
    const [labels, setLabels] = useState<KanbanLabel[]>([]);
    const [selectedCardId, setSelectedCardId] = useState<string>("");
    const [view, setView] = useState<ViewMode>("kanban");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draftCardTitles, setDraftCardTitles] = useState<Record<string, string>>({});
    const [activeComposerColumnId, setActiveComposerColumnId] = useState<string>("");
    const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const [cardDropTarget, setCardDropTarget] = useState<CardDropTarget | null>(null);
    const [boardListCollapsed, setBoardListCollapsed] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
    const composerInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    const selectedBoard = boards.find((board) => board.id === selectedBoardId);
    const selectedCard = cards.find((card) => card.id === selectedCardId);
    const visibleColumns = useMemo(
        () => columns.filter((column) => !column.archivedAt).sort((left, right) => left.sortOrder - right.sortOrder),
        [columns]
    );
    const activeCards = cards.filter((card) => !card.archivedAt);
    const archivedCards = cards.filter((card) => card.archivedAt);
    const activeDraggingCard = activeDragId?.startsWith("card:") ? cards.find((card) => card.id === activeDragId.slice(5)) : undefined;
    const activeDraggingColumn = activeDragId?.startsWith("column:") ? columns.find((column) => column.id === activeDragId.slice(7)) : undefined;

    async function loadBoards(): Promise<void> {
        try {
            setLoading(true);
            const api = getApi();
            const nextBoards = await api.kanban.listBoards();
            setBoards(nextBoards);
            const nextSelectedId = selectedBoardId && nextBoards.some((board) => board.id === selectedBoardId) ? selectedBoardId : nextBoards[0]?.id ?? "";
            setSelectedBoardId(nextSelectedId);
            if (nextSelectedId) await loadBoardData(nextSelectedId);
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setLoading(false);
        }
    }

    async function loadBoardData(boardId: string): Promise<void> {
        const api = getApi();
        const [nextColumns, nextCards, nextLabels] = await Promise.all([
            api.kanban.listColumns({ boardId, includeArchived: true }),
            api.kanban.listCards({ boardId, includeArchived: true }),
            api.kanban.listLabels({ boardId })
        ]);
        setColumns(nextColumns);
        setCards(nextCards);
        setLabels(nextLabels);
    }

    useEffect(() => {
        void loadBoards();
    }, []);

    useEffect(() => getApi().system.onShowKeyboardShortcuts(() => setHelpOpen(true)), []);
    useEffect(() => getApi().system.onShowAiSettings(() => setAiSettingsOpen(true)), []);

    async function selectBoard(boardId: string): Promise<void> {
        setSelectedBoardId(boardId);
        setSelectedCardId("");
        await loadBoardData(boardId);
    }

    function createBoard(): void {
        setTextDialog({
            title: "New board",
            label: "Board name",
            initialValue: "Product Roadmap",
            confirmLabel: "Create board",
            onSubmit: async (name) => {
                const board = await getApi().kanban.createBoard({ name });
                await loadBoards();
                await selectBoard(board.id);
            }
        });
    }

    async function saveBoardName(name: string): Promise<void> {
        if (!selectedBoard || name === selectedBoard.name) return;
        await getApi().kanban.renameBoard({ id: selectedBoard.id, name });
        await loadBoards();
    }

    async function deleteBoard(): Promise<void> {
        if (!selectedBoard) return;
        setConfirmDialog({
            title: "Delete board",
            message: `Delete "${selectedBoard.name}" and all cards? This cannot be undone.`,
            confirmLabel: "Delete board",
            onConfirm: async () => {
                await getApi().kanban.deleteBoard({ id: selectedBoard.id });
                setSelectedCardId("");
                await loadBoards();
            }
        });
    }

    function createColumn(): void {
        if (!selectedBoardId) return;
        setTextDialog({
            title: "New column",
            label: "Column name",
            initialValue: "Review",
            confirmLabel: "Create column",
            onSubmit: async (name) => {
                await getApi().kanban.createColumn({ boardId: selectedBoardId, name });
                await loadBoardData(selectedBoardId);
            }
        });
    }

    function renameColumn(column: KanbanColumn): void {
        setTextDialog({
            title: "Rename column",
            label: "Column name",
            initialValue: column.name,
            confirmLabel: "Save name",
            onSubmit: async (name) => {
                await getApi().kanban.updateColumn({ id: column.id, patch: { name } });
                await loadBoardData(column.boardId);
            }
        });
    }

    async function archiveColumn(column: KanbanColumn): Promise<void> {
        try {
            await getApi().kanban.archiveColumn({ id: column.id });
            await loadBoardData(column.boardId);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    async function setCompletionColumn(column: KanbanColumn): Promise<void> {
        try {
            await getApi().kanban.setCompletionColumn({ boardId: column.boardId, columnId: column.id });
            await loadBoards();
            await loadBoardData(column.boardId);
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    function setDraftCardTitle(columnId: string, value: string): void {
        setDraftCardTitles((current) => ({ ...current, [columnId]: value }));
    }

    function setComposerInputRef(columnId: string, node: HTMLInputElement | null): void {
        composerInputRefs.current[columnId] = node;
    }

    function focusComposer(columnId: string): void {
        window.requestAnimationFrame(() => composerInputRefs.current[columnId]?.focus());
    }

    function openCardComposerFromShortcut(): void {
        if (!selectedBoardId) return;
        const selectedCardColumnId = selectedCard && visibleColumns.some((column) => column.id === selectedCard.columnId) ? selectedCard.columnId : "";
        const activeComposerColumnIdIsVisible = activeComposerColumnId && visibleColumns.some((column) => column.id === activeComposerColumnId);
        const targetColumnId = selectedCardColumnId || (activeComposerColumnIdIsVisible ? activeComposerColumnId : "") || visibleColumns[0]?.id;
        if (!targetColumnId) return;
        setSelectedCardId("");
        setActiveComposerColumnId(targetColumnId);
        focusComposer(targetColumnId);
    }

    async function createCard(columnId: string): Promise<void> {
        if (!selectedBoardId) return;
        const title = draftCardTitles[columnId]?.trim();
        if (!title) return;
        try {
            const card = await getApi().kanban.createCard({ boardId: selectedBoardId, columnId, title });
            setDraftCardTitles((current) => ({ ...current, [columnId]: "" }));
            setActiveComposerColumnId("");
            await loadBoardData(selectedBoardId);
            setSelectedCardId(card.id);
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        }
    }

    async function updateCard(cardId: string, patch: Partial<KanbanCardPatch>): Promise<void> {
        const card = cards.find((item) => item.id === cardId);
        if (!card || !selectedBoardId) return;
        const nextPatch: Partial<KanbanCardPatch> = {
            title: patch.title,
            columnId: patch.columnId,
            descriptionMarkdown: patch.descriptionMarkdown,
            descriptionJson: patch.descriptionJson,
            descriptionText: patch.descriptionText,
            priority: patch.priority,
            subtasks: patch.subtasks,
            comments: patch.comments
        };
        if (Object.prototype.hasOwnProperty.call(patch, "dueDate")) nextPatch.dueDate = patch.dueDate ?? null;
        if (Object.prototype.hasOwnProperty.call(patch, "startDate")) nextPatch.startDate = patch.startDate ?? null;
        if (Object.prototype.hasOwnProperty.call(patch, "endDate")) nextPatch.endDate = patch.endDate ?? null;
        await getApi().kanban.updateCard({ id: cardId, patch: nextPatch });
        await loadBoardData(selectedBoardId);
        setError(null);
    }

    async function saveCardRecurrence(cardId: string, trigger: KanbanRecurrenceTrigger, cycle: KanbanRecurrenceCycle): Promise<void> {
        const card = cards.find((item) => item.id === cardId);
        if (!card || !selectedBoardId) return;
        if (card.recurrence) {
            await getApi().kanban.updateCardRecurrence({ cardId, trigger, cycle });
        } else {
            await getApi().kanban.enableCardRecurrence({ cardId, trigger, cycle });
        }
        await loadBoardData(selectedBoardId);
        setError(null);
    }

    async function disableCardRecurrence(cardId: string): Promise<void> {
        if (!selectedBoardId) return;
        await getApi().kanban.disableCardRecurrence({ cardId });
        await loadBoardData(selectedBoardId);
        setError(null);
    }

    async function archiveCard(cardId: string): Promise<void> {
        if (!selectedBoardId) return;
        await getApi().kanban.archiveCard({ id: cardId });
        setSelectedCardId("");
        await loadBoardData(selectedBoardId);
    }

    async function restoreCard(cardId: string): Promise<void> {
        if (!selectedBoardId) return;
        await getApi().kanban.restoreCard({ id: cardId });
        await loadBoardData(selectedBoardId);
    }

    async function deleteCard(cardId: string): Promise<void> {
        if (!selectedBoardId) return;
        setConfirmDialog({
            title: "Delete task",
            message: "Delete this task permanently? This cannot be undone.",
            confirmLabel: "Delete task",
            onConfirm: async () => {
                await getApi().kanban.deleteCard({ id: cardId });
                setSelectedCardId("");
                await loadBoardData(selectedBoardId);
            }
        });
    }

    async function createAndAttachLabel(card: KanbanCard, name: string): Promise<void> {
        if (!selectedBoardId) return;
        const label = await getApi().kanban.createLabel({ boardId: selectedBoardId, name, color: stableLabelColor(selectedBoardId, name) });
        await getApi().kanban.setCardLabels({ cardId: card.id, labelIds: [...card.labelIds, label.id] });
        await loadBoardData(selectedBoardId);
    }

    async function toggleCardLabel(card: KanbanCard, labelId: string): Promise<void> {
        const next = card.labelIds.includes(labelId) ? card.labelIds.filter((id) => id !== labelId) : [...card.labelIds, labelId];
        await getApi().kanban.setCardLabels({ cardId: card.id, labelIds: next });
        if (selectedBoardId) await loadBoardData(selectedBoardId);
    }

    function handleDragStart(event: DragStartEvent): void {
        setActiveDragId(String(event.active.id));
        setCardDropTarget(null);
    }

    function handleDragOver(event: DragOverEvent): void {
        setCardDropTarget(cardDropTargetFromEvent(event));
    }

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent): void {
            const action = keyboardShortcutFromEvent(event, isEditableShortcutTarget(event.target));
            if (!action) return;

            if (action.type !== "openHelp" && action.type !== "close" && (helpOpen || textDialog || confirmDialog)) {
                return;
            }

            if (action.type === "openHelp") {
                event.preventDefault();
                setHelpOpen(true);
                return;
            }

            if (action.type === "close") {
                if (helpOpen) {
                    event.preventDefault();
                    setHelpOpen(false);
                }
                else if (textDialog) {
                    event.preventDefault();
                    setTextDialog(null);
                }
                else if (confirmDialog) {
                    event.preventDefault();
                    setConfirmDialog(null);
                }
                else if (activeComposerColumnId) {
                    event.preventDefault();
                    setDraftCardTitle(activeComposerColumnId, "");
                    setActiveComposerColumnId("");
                }
                else if (selectedCardId) {
                    event.preventDefault();
                    setSelectedCardId("");
                }
                return;
            }

            if (action.type === "selectBoardByIndex") {
                event.preventDefault();
                const board = boards[action.index];
                if (board && board.id !== selectedBoardId) void selectBoard(board.id);
                return;
            }

            if (action.type === "toggleBoardList") {
                event.preventDefault();
                setBoardListCollapsed((current) => !current);
                return;
            }

            if (action.type === "setView") {
                event.preventDefault();
                setView(action.view);
                return;
            }

            if (action.type === "createCard") {
                event.preventDefault();
                openCardComposerFromShortcut();
                return;
            }

            if (action.type === "createColumn") {
                event.preventDefault();
                createColumn();
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeComposerColumnId, boards, confirmDialog, helpOpen, selectedBoardId, selectedCard, selectedCardId, textDialog, visibleColumns]);

    async function handleDragEnd(event: DragEndEvent): Promise<void> {
        try {
            if (!event.over || !selectedBoardId) return;
            const activeId = String(event.active.id);
            const overId = String(event.over.id);
            if (activeId === overId) return;

            if (activeId.startsWith("column:") && overId.startsWith("column:")) {
                const columnId = activeId.slice(7);
                const overColumnId = overId.slice(7);
                const activeIndex = visibleColumns.findIndex((column) => column.id === columnId);
                const overIndex = visibleColumns.findIndex((column) => column.id === overColumnId);
                const position = activeIndex < overIndex ? { beforeId: overColumnId } : { afterId: overColumnId };
                await getApi().kanban.reorderColumn({ id: columnId, ...position });
                await loadBoardData(selectedBoardId);
                return;
            }

            if (!activeId.startsWith("card:")) return;
            const cardId = activeId.slice(5);
            const target = cardDropTargetFromEvent(event);
            if (!target) return;
            const position = target.beforeId ? { beforeId: target.beforeId } : target.afterId ? { afterId: target.afterId } : {};
            await getApi().kanban.reorderCard({ id: cardId, toColumnId: target.columnId, ...position });
            await loadBoardData(selectedBoardId);
        } finally {
            setActiveDragId(null);
            setCardDropTarget(null);
        }
    }

    function cardDropTargetFromEvent(event: DragOverEvent | DragEndEvent): CardDropTarget | null {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : "";
        if (!activeId.startsWith("card:") || !overId || activeId === overId) return null;

        const cardId = activeId.slice(5);
        const activeCard = activeCards.find((card) => card.id === cardId);
        if (!activeCard) return null;

        if (overId.startsWith("column:")) {
            const columnId = overId.slice(7);
            const targetCards = sortedCardsInColumn(activeCards, columnId).filter((card) => card.id !== cardId);
            const lastCard = targetCards.at(-1);
            return {
                columnId,
                index: targetCards.length,
                ...(lastCard ? { beforeId: lastCard.id } : {})
            };
        }

        if (!overId.startsWith("card:")) return null;
        const overCard = activeCards.find((card) => card.id === overId.slice(5));
        if (!overCard) return null;

        const targetCards = sortedCardsInColumn(activeCards, overCard.columnId).filter((card) => card.id !== cardId);
        const overIndex = targetCards.findIndex((card) => card.id === overCard.id);
        if (overIndex < 0) return null;

        const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
        const overRect = event.over?.rect;
        const activeCenterY = activeRect ? activeRect.top + activeRect.height / 2 : 0;
        const overCenterY = overRect ? overRect.top + overRect.height / 2 : activeCenterY;
        const placeBefore = activeCenterY <= overCenterY;
        const targetIndex = placeBefore ? overIndex : overIndex + 1;

        return {
            columnId: overCard.columnId,
            index: targetIndex,
            ...(placeBefore ? { afterId: overCard.id } : { beforeId: overCard.id })
        };
    }

    return (
        <section className={`kanban-tool ${boardListCollapsed ? "board-list-collapsed" : ""}`}>
            <aside className="kanban-boards" aria-label="Boards">
                <div className="kanban-brand">
                    <button
                        type="button"
                        className="kanban-brand-toggle"
                        aria-label={boardListCollapsed ? "Open board list" : "Collapse board list"}
                        onClick={() => setBoardListCollapsed((current) => !current)}
                    >
                        <KanbanSquare size={18} />
                    </button>
                    <span>Kanban</span>
                </div>
                <div className="kanban-board-list">
                    {boards.map((board) => (
                        <button
                            type="button"
                            key={board.id}
                            className={board.id === selectedBoardId ? "active" : ""}
                            onClick={() => void selectBoard(board.id)}
                            aria-label={board.name}
                        >
                            <BoardGlyph name={board.name} />
                            <span>{board.name}</span>
                            <small>{new Date(board.updatedAt).toLocaleDateString()}</small>
                        </button>
                    ))}
                </div>
                <button type="button" className="kanban-board-add-trigger" onClick={createBoard}>
                    <Plus size={14} /> {boardListCollapsed ? null : "Board"}
                </button>
            </aside>

            <main className="kanban-main">
                <header className="kanban-topbar">
                    <div>
                        <InlineBoardTitle board={selectedBoard} onSave={saveBoardName} />
                        <p>{selectedBoard ? `${columns.length} columns, ${cards.filter((card) => !card.archivedAt).length} active cards` : "Create a board to start"}</p>
                    </div>
                    <div className="kanban-actions">
                        <Segmented value={view} onChange={setView} />
                        <IconButton type="button" aria-label="Delete board" variant="danger" onClick={deleteBoard} disabled={!selectedBoard}>
                            <Trash2 size={15} />
                        </IconButton>
                    </div>
                </header>

                <div className="kanban-main-body">
                    {error ? <div className="kanban-error">{error}</div> : null}
                    {loading ? <div className="kanban-empty">Loading boards...</div> : null}
                    {!loading && boards.length === 0 ? <EmptyBoard onCreate={createBoard} /> : null}

                    {selectedBoard ? (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragCancel={() => { setActiveDragId(null); setCardDropTarget(null); }} onDragEnd={(event) => void handleDragEnd(event)}>
                            {view === "kanban" ? (
                                <SortableContext items={visibleColumns.map((column) => `column:${column.id}`)} strategy={horizontalListSortingStrategy}>
                                    <div key="kanban" className="kanban-board-canvas kanban-view-panel">
                                        {visibleColumns.map((column) => (
                                            <SortableColumn
                                                key={column.id}
                                                column={column}
                                                completionColumnId={selectedBoard.completionColumnId}
                                                cards={activeCards.filter((card) => card.columnId === column.id).sort((left, right) => left.sortOrder - right.sortOrder)}
                                                labels={labels}
                                                draftTitle={draftCardTitles[column.id] ?? ""}
                                                composerOpen={activeComposerColumnId === column.id}
                                                composerInputRef={(node) => setComposerInputRef(column.id, node)}
                                                onDraftTitleChange={(value) => setDraftCardTitle(column.id, value)}
                                                onOpenComposer={() => setActiveComposerColumnId(column.id)}
                                                onCloseComposer={() => { setDraftCardTitle(column.id, ""); setActiveComposerColumnId(""); }}
                                                onCreateCard={() => void createCard(column.id)}
                                                onOpenCard={setSelectedCardId}
                                                onArchiveCard={(cardId) => void archiveCard(cardId)}
                                                onDeleteCard={(cardId) => void deleteCard(cardId)}
                                                onRename={() => void renameColumn(column)}
                                                onArchive={() => void archiveColumn(column)}
                                                onSetCompletion={() => void setCompletionColumn(column)}
                                                dropTarget={activeDraggingCard && cardDropTarget?.columnId === column.id ? cardDropTarget : null}
                                            />
                                        ))}
                                        <button type="button" className="kanban-add-column" onClick={createColumn}>
                                            <Plus size={15} /> Add column
                                        </button>
                                    </div>
                                </SortableContext>
                            ) : null}

                            {view === "list" ? (
                                <ListView
                                    key="list"
                                    columns={visibleColumns}
                                    cards={activeCards}
                                    labels={labels}
                                    onOpenCard={setSelectedCardId}
                                    onMoveCard={(cardId, columnId) => void updateCard(cardId, { columnId })}
                                    onChangeDateRange={(cardId, startDate, endDate) => void updateCard(cardId, { startDate, endDate })}
                                    onArchiveCard={(cardId) => void archiveCard(cardId)}
                                    onDeleteCard={(cardId) => void deleteCard(cardId)}
                                />
                            ) : null}

                            {view === "archive" ? <ArchiveView key="archive" cards={archivedCards} labels={labels} onOpenCard={setSelectedCardId} onRestore={restoreCard} onDelete={deleteCard} /> : null}
                            <DragOverlay dropAnimation={null}>
                                {activeDraggingCard ? <CardDragPreview card={activeDraggingCard} labels={labels} /> : null}
                                {activeDraggingColumn ? <ColumnDragPreview column={activeDraggingColumn} /> : null}
                            </DragOverlay>
                        </DndContext>
                    ) : null}

                    {helpOpen ? <KeyboardShortcutsHelp onClose={() => setHelpOpen(false)} /> : null}
                    {aiSettingsOpen ? <AiSettingsDialog onClose={() => setAiSettingsOpen(false)} /> : null}

                    {selectedCard ? (
                        <CardDetails
                            card={selectedCard}
                            cards={activeCards}
                            columns={visibleColumns}
                            labels={labels}
                            onClose={() => setSelectedCardId("")}
                            onSave={updateCard}
                            onSaveRecurrence={saveCardRecurrence}
                            onDisableRecurrence={disableCardRecurrence}
                            onCreateLabel={createAndAttachLabel}
                            onToggleLabel={toggleCardLabel}
                        />
                    ) : null}
                </div>
            </main>
            {textDialog ? <TextDialog state={textDialog} onClose={() => setTextDialog(null)} /> : null}
            {confirmDialog ? <ConfirmDialog state={confirmDialog} onClose={() => setConfirmDialog(null)} /> : null}
        </section>
    );
}

function KeyboardShortcutsHelp({ onClose }: { onClose: () => void }): JSX.Element {
    return (
        <div className="kanban-dialog-backdrop" role="presentation">
            <section className="kanban-dialog kanban-help-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
                <header>
                    <span className="kanban-help-title"><CircleHelp size={17} />Keyboard Shortcuts</span>
                    <button type="button" onClick={onClose} aria-label="Close help"><X size={16} /></button>
                </header>
                <div className="kanban-help-body">
                    <div className="kanban-help-shortcuts">
                        {keyboardShortcutGroups.map((group) => (
                            <section className="kanban-help-group" key={group.title}>
                                <h3>{group.title}</h3>
                                <div className="kanban-help-shortcut-list">
                                    {group.shortcuts.map((shortcut) => (
                                        <article className="kanban-help-shortcut" key={shortcut.title}>
                                            <div>
                                                <strong>{shortcut.title}</strong>
                                                <span>{shortcut.description}</span>
                                            </div>
                                            <span className="kanban-help-keys" aria-label={shortcut.keys.join(" plus ")}>
                                                {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
                                            </span>
                                        </article>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                    <aside className="kanban-help-guide" aria-label="Quick guide">
                        <h3><Command size={15} />Quick Guide</h3>
                        <ul>
                            {helpGuides.map((guide) => <li key={guide}>{guide}</li>)}
                        </ul>
                    </aside>
                </div>
            </section>
        </div>
    );
}

function AiSettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
    const [settings, setSettings] = useState<AiSettingsState | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [baseUrl, setBaseUrl] = useState("");
    const [model, setModel] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [pending, setPending] = useState(false);
    const [testResult, setTestResult] = useState<AiTestConnectionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const connectionError = settings?.lastError?.scope === "testConnection" ? settings.lastError.message : null;

    useEffect(() => {
        let active = true;
        void getApi().ai.getSettings()
            .then((nextSettings) => {
                if (!active) return;
                setSettings(nextSettings);
                setEnabled(nextSettings.enabled || nextSettings.configured);
                setBaseUrl(nextSettings.baseUrl);
                setModel(nextSettings.model);
            })
            .catch((caught) => {
                if (active) setError(errorMessage(caught));
            });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!testResult?.ok) return;
        const timeout = window.setTimeout(() => setTestResult(null), 3500);
        return () => window.clearTimeout(timeout);
    }, [testResult]);

    async function save(): Promise<AiSettingsState> {
        setPending(true);
        setError(null);
        try {
            const nextSettings = await getApi().ai.saveSettings({
                enabled,
                baseUrl,
                model,
                ...(apiKey.trim() ? { apiKey } : {})
            });
            setSettings(nextSettings);
            setApiKey("");
            return nextSettings;
        } catch (caught) {
            const message = errorMessage(caught);
            setError(message);
            throw caught;
        } finally {
            setPending(false);
        }
    }

    async function testConnection(): Promise<void> {
        try {
            await save();
            setPending(true);
            const result = await getApi().ai.testConnection();
            setTestResult(result);
            const nextSettings = await getApi().ai.getSettings();
            setSettings(nextSettings);
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setPending(false);
        }
    }

    async function saveAndClose(): Promise<void> {
        try {
            await save();
            onClose();
        } catch { }
    }

    return (
        <div className="kanban-dialog-backdrop" role="presentation">
            <section className="kanban-dialog kanban-ai-settings-dialog" role="dialog" aria-modal="true" aria-label="AI Settings">
                <header>
                    <strong>AI Settings</strong>
                    <button type="button" onClick={onClose} disabled={pending} aria-label="Close AI Settings"><X size={16} /></button>
                </header>
                <div className="kanban-ai-settings-body">
                    <label className="kanban-ai-toggle">
                        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                        <span>Enable AI suggestions</span>
                    </label>
                    <label>
                        <span>Base URL</span>
                        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1" />
                    </label>
                    <label>
                        <span>Model</span>
                        <input value={model} onChange={(event) => setModel(event.target.value)} placeholder="llama3.2" />
                    </label>
                    <label>
                        <span>API key</span>
                        <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder={settings?.hasApiKey ? "Saved key will be kept" : "Optional for Ollama"} />
                    </label>
                    <div className={`kanban-ai-status ${settings?.configured ? "configured" : ""}`}>
                        {settings?.configured ? "Configured" : "Not configured"}
                    </div>
                    {testResult ? <p className={testResult.ok ? "kanban-ai-result ok" : "kanban-ai-result"} aria-live="polite">{testResult.ok ? <ArrowRight size={14} /> : null}<span>{testResult.message}</span></p> : null}
                    {!testResult && connectionError ? <p className="kanban-ai-result">{connectionError}</p> : null}
                    {error ? <p className="kanban-ai-result">{error}</p> : null}
                </div>
                <footer>
                    <button type="button" onClick={() => void getApi().ai.openLogFile()} disabled={pending}>Open log</button>
                    <button type="button" onClick={() => void testConnection()} disabled={pending}>{pending ? "Testing..." : "Test Connection"}</button>
                    <button type="button" className="primary" onClick={() => void saveAndClose()} disabled={pending}>{pending ? "Saving..." : "Save"}</button>
                </footer>
            </section>
        </div>
    );
}

function TextDialog({ state, onClose }: { state: TextDialogState; onClose: () => void }): JSX.Element {
    const [value, setValue] = useState(state.initialValue);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const trimmedValue = value.trim();

    return (
        <div className="kanban-dialog-backdrop" role="presentation">
            <form
                className="kanban-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={state.title}
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!trimmedValue) return;
                    setPending(true);
                    void state.onSubmit(trimmedValue)
                        .then(onClose)
                        .catch((caught) => setError(errorMessage(caught)))
                        .finally(() => setPending(false));
                }}
            >
                <header>
                    <strong>{state.title}</strong>
                    <button type="button" onClick={onClose} disabled={pending} aria-label="Close dialog"><X size={16} /></button>
                </header>
                <label>
                    <span>{state.label}</span>
                    <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} />
                </label>
                {error ? <p>{error}</p> : null}
                <footer>
                    <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
                    <button type="submit" className="primary" disabled={!trimmedValue || pending}>{pending ? "Saving..." : state.confirmLabel}</button>
                </footer>
            </form>
        </div>
    );
}

function ConfirmDialog({ state, onClose }: { state: ConfirmDialogState; onClose: () => void }): JSX.Element {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <div className="kanban-dialog-backdrop" role="presentation">
            <section className="kanban-dialog" role="dialog" aria-modal="true" aria-label={state.title}>
                <header>
                    <strong>{state.title}</strong>
                    <button type="button" onClick={onClose} disabled={pending} aria-label="Close dialog"><X size={16} /></button>
                </header>
                <div className="kanban-dialog-message">{state.message}</div>
                {error ? <p>{error}</p> : null}
                <footer>
                    <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
                    <button
                        type="button"
                        className="danger"
                        disabled={pending}
                        onClick={() => {
                            setPending(true);
                            void state.onConfirm()
                                .then(onClose)
                                .catch((caught) => setError(errorMessage(caught)))
                                .finally(() => setPending(false));
                        }}
                    >
                        {pending ? "Deleting..." : state.confirmLabel}
                    </button>
                </footer>
            </section>
        </div>
    );
}

function Segmented({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }): JSX.Element {
    const options: Array<{ value: ViewMode; label: string; icon: JSX.Element }> = [
        { value: "kanban", label: "Kanban", icon: <Columns3 size={14} /> },
        { value: "list", label: "List", icon: <List size={14} /> },
        { value: "archive", label: "Archive", icon: <Archive size={14} /> }
    ];

    return (
        <SegmentedControl value={value} options={options} ariaLabel="View mode" onChange={(nextValue) => onChange(nextValue as ViewMode)} />
    );
}

function BoardGlyph({ name }: { name: string }): JSX.Element {
    const glyphs = ["#", "<>", "{}", "//", "[]", "@", "*", "~"];
    const colors = ["#756858", "#6f7a43", "#b36a3c", "#8f6f4f", "#9a5f54", "#6f6251"];
    const seed = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
    return (
        <span className="kanban-board-glyph" style={{ color: colors[seed % colors.length] }} aria-hidden="true">
            {glyphs[seed % glyphs.length]}
        </span>
    );
}

function InlineBoardTitle({ board, onSave }: { board?: KanbanBoard; onSave: (name: string) => Promise<void> }): JSX.Element {
    const [value, setValue] = useState(board?.name ?? "");
    const [pending, setPending] = useState(false);

    useEffect(() => {
        setValue(board?.name ?? "");
    }, [board?.id, board?.name]);

    async function commit(): Promise<void> {
        if (pending) return;
        const nextName = value.trim();
        if (!board || !nextName) {
            setValue(board?.name ?? "");
            return;
        }
        if (nextName === board.name) {
            return;
        }
        setPending(true);
        try {
            await onSave(nextName);
        } catch {
            setValue(board.name);
        } finally {
            setPending(false);
        }
    }

    if (!board) {
        return <h2 className="kanban-board-title empty">No board</h2>;
    }

    return (
        <input
            className="kanban-board-title-input"
            value={value}
            disabled={pending}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
                if (event.key === "Enter") void commit();
                if (event.key === "Escape") setValue(board.name);
            }}
            aria-label="Board name"
        />
    );
}

function EmptyBoard({ onCreate }: { onCreate: () => void }): JSX.Element {
    return (
        <div className="kanban-empty">
            <KanbanSquare size={28} />
            <button type="button" onClick={onCreate}>Create first board</button>
        </div>
    );
}

function sortedCardsInColumn(cards: KanbanCard[], columnId: string): KanbanCard[] {
    return cards.filter((card) => card.columnId === columnId).sort((left, right) => left.sortOrder - right.sortOrder);
}

function cardAiContext(card: KanbanCard, cards: KanbanCard[], labels: KanbanLabel[], columns: KanbanColumn[]): AiSuggestionCardContext {
    return {
        currentCard: card,
        relatedCards: relatedCardsForAiContext(card, cards),
        boardLabels: labels,
        columnName: columns.find((column) => column.id === card.columnId)?.name
    };
}

function SortableColumn({
    column,
    completionColumnId,
    cards,
    labels,
    draftTitle,
    composerOpen,
    composerInputRef,
    onDraftTitleChange,
    onOpenComposer,
    onCloseComposer,
    onCreateCard,
    onOpenCard,
    onArchiveCard,
    onDeleteCard,
    onRename,
    onArchive,
    onSetCompletion,
    dropTarget
}: {
    column: KanbanColumn;
    completionColumnId?: string;
    cards: KanbanCard[];
    labels: KanbanLabel[];
    draftTitle: string;
    composerOpen: boolean;
    composerInputRef: (node: HTMLInputElement | null) => void;
    onDraftTitleChange: (value: string) => void;
    onOpenComposer: () => void;
    onCloseComposer: () => void;
    onCreateCard: () => void;
    onOpenCard: (id: string) => void;
    onArchiveCard: (id: string) => void;
    onDeleteCard: (id: string) => void;
    onRename: () => void;
    onArchive: () => void;
    onSetCompletion: () => void;
    dropTarget: CardDropTarget | null;
}): JSX.Element {
    const { attributes, isDragging, isOver, listeners, setNodeRef, transform, transition } = useSortable({ id: `column:${column.id}` });
    const dropIndex = dropTarget?.index ?? -1;
    const [menuOpen, setMenuOpen] = useState(false);
    const isCompletionColumn = completionColumnId === column.id;

    return (
        <section ref={setNodeRef} className={`kanban-column ${isOver || dropTarget ? "over" : ""} ${dropTarget ? "drop-target" : ""} ${isDragging ? "dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
            <header>
                <span className="kanban-column-dot" style={{ background: column.color ?? "#9ca3af" }} />
                <div className="kanban-column-title" {...attributes} {...listeners} aria-label={`Drag ${column.name}`}>
                    <strong>{column.name}</strong>
                    {isCompletionColumn ? <span className="kanban-completion-marker" aria-label="完成列" title="完成列"><Check size={12} /></span> : null}
                </div>
                <button type="button" className="kanban-column-rename" onPointerDown={(event) => event.stopPropagation()} onClick={onRename} aria-label={`Rename ${column.name}`}><Pencil size={13} /></button>
                <div
                    className="kanban-column-menu"
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false);
                    }}
                >
                    <button type="button" className="kanban-column-more" onClick={() => setMenuOpen((current) => !current)} aria-label={`Column actions for ${column.name}`} aria-expanded={menuOpen}><MoreHorizontal size={14} /></button>
                    {menuOpen ? (
                        <div className="kanban-column-menu-popover" role="menu">
                            <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => { onSetCompletion(); setMenuOpen(false); }} disabled={isCompletionColumn}>
                                <Check size={13} /> Mark done
                            </button>
                            <button type="button" role="menuitem" onMouseDown={(event) => event.preventDefault()} onClick={() => { onArchive(); setMenuOpen(false); }}>
                                <Archive size={13} /> Archive
                            </button>
                        </div>
                    ) : null}
                </div>
                <span className="kanban-column-count">{cards.length}</span>
            </header>
            <SortableContext items={cards.map((card) => `card:${card.id}`)} strategy={verticalListSortingStrategy}>
                <div className="kanban-card-stack">
                    {dropIndex === 0 ? <div className="kanban-card-drop-indicator" aria-hidden="true" /> : null}
                    {cards.map((card, index) => (
                        <div className="kanban-card-stack-item" key={card.id}>
                            <SortableCard
                                card={card}
                                labels={labels}
                                onOpen={() => onOpenCard(card.id)}
                                onArchive={() => onArchiveCard(card.id)}
                                onDelete={() => onDeleteCard(card.id)}
                            />
                            {dropIndex === index + 1 ? <div className="kanban-card-drop-indicator" aria-hidden="true" /> : null}
                        </div>
                    ))}
                    {cards.length === 0 && !dropTarget ? <div className="kanban-column-empty">Drop cards here</div> : null}
                </div>
            </SortableContext>
            {composerOpen ? (
                <form className="kanban-card-composer open" onSubmit={(event) => { event.preventDefault(); onCreateCard(); }}>
                    <input
                        ref={composerInputRef}
                        value={draftTitle}
                        onChange={(event) => onDraftTitleChange(event.target.value)}
                        placeholder="Task title"
                        autoFocus
                        aria-label="Task title"
                    />
                    <div className="kanban-card-composer-actions">
                        <button type="submit" disabled={!draftTitle.trim()} aria-label={`Add task to ${column.name}`}>
                            <Plus size={14} /> Add
                        </button>
                        <button type="button" onClick={onCloseComposer} aria-label={`Cancel task in ${column.name}`}>
                            <X size={14} />
                        </button>
                    </div>
                </form>
            ) : (
                <button type="button" className="kanban-card-add-trigger" onClick={onOpenComposer} aria-label={`Add task to ${column.name}`}>
                    <Plus size={14} /> Add card
                </button>
            )}
        </section>
    );
}

function ColumnDragPreview({ column }: { column: KanbanColumn }): JSX.Element {
    return (
        <section className="kanban-column kanban-drag-preview">
            <header>
                <span className="kanban-column-dot" style={{ background: column.color ?? "#9ca3af" }} />
                <div className="kanban-column-title">
                    <strong>{column.name}</strong>
                    <small>Moving column</small>
                </div>
            </header>
            <div className="kanban-column-preview-fill">
                <span />
                <span />
                <span />
            </div>
        </section>
    );
}

function CardDragPreview({ card, labels }: { card: KanbanCard; labels: KanbanLabel[] }): JSX.Element {
    const cardLabels = labels.filter((label) => card.labelIds.includes(label.id));
    return (
        <article className="kanban-card kanban-drag-preview">
            <div className="kanban-card-topline">
                <PriorityBadge priority={card.priority} />
                <span>{formatDisplayDate(card.updatedAt)}</span>
            </div>
            <div className="kanban-card-open">
                <span>{card.title}</span>
                {card.descriptionText ? <small>{card.descriptionText}</small> : null}
            </div>
            <div className="kanban-card-meta-band">
                {cardLabels.map((label) => <LabelChip key={label.id} label={label} />)}
            </div>
        </article>
    );
}

function SortableCard({ card, labels, onOpen, onArchive, onDelete }: {
    card: KanbanCard;
    labels: KanbanLabel[];
    onOpen: () => void;
    onArchive: () => void;
    onDelete: () => void;
}): JSX.Element {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `card:${card.id}` });
    const cardLabels = labels.filter((label) => card.labelIds.includes(label.id));
    return (
        <article ref={setNodeRef} className={`kanban-card ${isDragging ? "dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} aria-label={`Drag ${card.title}`}>
            <div className="kanban-card-topline">
                <PriorityBadge priority={card.priority} />
                <span className="kanban-card-id">Updated {formatDisplayDate(card.updatedAt)}</span>
                <span className="kanban-card-actions">
                    <button type="button" onClick={onOpen} aria-label={`Edit ${card.title}`}><Pencil size={13} /></button>
                    <button type="button" onClick={onArchive} aria-label={`Archive ${card.title}`}><Archive size={13} /></button>
                    <button type="button" onClick={onDelete} aria-label={`Delete ${card.title}`}><Trash2 size={13} /></button>
                </span>
            </div>
            <button type="button" className="kanban-card-open" onClick={onOpen}>
                <span>{card.title}</span>
                {card.descriptionText ? <small>{card.descriptionText}</small> : null}
            </button>
            <div className="kanban-card-meta-band">
                {cardLabels.length > 0 ? cardLabels.map((label) => <LabelChip key={label.id} label={label} />) : <span className="kanban-card-muted"><Tag size={12} /> No labels</span>}
            </div>
            <div className="kanban-card-footerline">
                <span className="kanban-date-chip"><CalendarDays size={12} /> {formatCardDateRange(card)}</span>
                {card.recurrence ? <RecurrenceBadge card={card} compact /> : null}
            </div>
        </article>
    );
}

function ListView({ columns, cards, labels, onOpenCard, onMoveCard, onChangeDateRange, onArchiveCard, onDeleteCard }: {
    columns: KanbanColumn[];
    cards: KanbanCard[];
    labels: KanbanLabel[];
    onOpenCard: (id: string) => void;
    onMoveCard: (cardId: string, columnId: string) => void;
    onChangeDateRange: (cardId: string, startDate: number | null, endDate: number | null) => void;
    onArchiveCard: (cardId: string) => void;
    onDeleteCard: (cardId: string) => void;
}): JSX.Element {
    return (
        <div className="kanban-list-view kanban-view-panel">
            {columns.map((column) => {
                const columnCards = cards.filter((card) => card.columnId === column.id).sort((left, right) => left.sortOrder - right.sortOrder);
                return (
                    <section key={column.id} className="kanban-list-section">
                        <h3><span style={{ background: column.color ?? "#9ca3af" }} />{column.name}<small>{columnCards.length} cards</small></h3>
                        {columnCards.map((card) => (
                            <article className="kanban-list-row" key={card.id}>
                                <button type="button" className="kanban-list-title" onClick={() => onOpenCard(card.id)}>
                                    <span>{card.title}</span>
                                    <small>{card.descriptionText || `Updated ${formatDisplayDate(card.updatedAt)}`}</small>
                                </button>
                                <span className="kanban-list-labels">
                                    {labels.filter((label) => card.labelIds.includes(label.id)).map((label) => <LabelChip key={label.id} label={label} />)}
                                </span>
                                <PriorityBadge priority={card.priority} />
                                <ListDateRangeControl card={card} onChange={(startDate, endDate) => onChangeDateRange(card.id, startDate, endDate)} />
                                {card.recurrence ? <RecurrenceBadge card={card} compact /> : <span />}
                                <select value={card.columnId} onChange={(event) => onMoveCard(card.id, event.target.value)}>
                                    {columns.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                                </select>
                                <span className="kanban-list-actions">
                                    <button type="button" onClick={() => onArchiveCard(card.id)} aria-label={`Archive ${card.title}`}><Archive size={14} /></button>
                                    <button type="button" onClick={() => onDeleteCard(card.id)} aria-label={`Delete ${card.title}`}><Trash2 size={14} /></button>
                                </span>
                            </article>
                        ))}
                    </section>
                );
            })}
        </div>
    );
}

function ListDateRangeControl({ card, onChange }: { card: KanbanCard; onChange: (startDate: number | null, endDate: number | null) => void }): JSX.Element {
    return (
        <DateRangePicker
            className="kanban-list-date-control"
            ariaLabel={`Choose date range for ${card.title}`}
            startDate={cardStartDate(card) ?? null}
            endDate={cardEndDate(card) ?? null}
            onChange={onChange}
            compact
        />
    );
}

function DateRangePicker({ startDate, endDate, onChange, ariaLabel, className = "", compact = false }: {
    startDate: number | null;
    endDate: number | null;
    onChange: (startDate: number | null, endDate: number | null) => void;
    ariaLabel: string;
    className?: string;
    compact?: boolean;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const [month, setMonth] = useState(() => new Date(startDate ?? endDate ?? Date.now()));
    const selectedStart = startDate ?? undefined;
    const selectedEnd = endDate ?? undefined;

    useEffect(() => {
        if (!open) return;
        setMonth(new Date(startDate ?? endDate ?? Date.now()));
    }, [endDate, open, startDate]);

    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const cells = calendarCells(year, monthIndex);
    const monthTitle = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    function selectDate(timestamp: number): void {
        if (selectedStart === undefined || selectedEnd !== undefined) {
            onChange(timestamp, null);
            return;
        }

        const nextRange = normalizeDateRange(selectedStart, timestamp);
        onChange(nextRange.startDate, nextRange.endDate);
        setOpen(false);
    }

    function clearRange(): void {
        onChange(null, null);
        setOpen(false);
    }

    return (
        <span
            className={`kanban-date-range-picker ${className} ${compact ? "compact" : ""}`.trim()}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
        >
            <button type="button" className="kanban-date-picker-trigger" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
                <CalendarDays size={compact ? 12 : 14} />
            </button>
            <button type="button" className="kanban-date-range-value" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
                {formatDateRange(startDate ?? undefined, endDate ?? undefined)}
            </button>
            {open ? (
                <div className="kanban-calendar-popover" role="dialog" aria-label="Date range picker">
                    <div className="kanban-calendar-nav">
                        <button type="button" onClick={() => setMonth(new Date(year, monthIndex - 1, 1))} aria-label="Previous month"><ChevronLeft size={15} /></button>
                        <strong>{monthTitle}</strong>
                        <button type="button" onClick={() => setMonth(new Date(year, monthIndex + 1, 1))} aria-label="Next month"><ChevronRight size={15} /></button>
                    </div>
                    <div className="kanban-calendar-grid">
                        {weekdaysShort.map((weekday) => <span key={weekday} className="kanban-calendar-weekday">{weekday}</span>)}
                        {cells.map((cell) => {
                            const timestamp = dateOnlyTimestamp(cell.year, cell.month, cell.day);
                            const isSelectedStart = selectedStart === timestamp;
                            const isSelectedEnd = selectedEnd === timestamp;
                            const isInRange = Boolean(selectedStart !== undefined && selectedEnd !== undefined && timestamp > selectedStart && timestamp < selectedEnd);
                            const isToday = timestamp === todayTimestamp();
                            return (
                                <button
                                    type="button"
                                    key={`${cell.year}-${cell.month}-${cell.day}`}
                                    className={`kanban-calendar-day ${cell.otherMonth ? "other-month" : ""} ${isToday ? "today" : ""} ${isSelectedStart ? "selected-start" : ""} ${isSelectedEnd ? "selected-end" : ""} ${isInRange ? "in-range" : ""}`}
                                    onClick={() => selectDate(timestamp)}
                                >
                                    {cell.day}
                                </button>
                            );
                        })}
                    </div>
                    <div className="kanban-calendar-footer">
                        <span>{selectedStart !== undefined && selectedEnd === undefined ? "Pick an end date" : formatDateRange(startDate ?? undefined, endDate ?? undefined)}</span>
                        <button type="button" onClick={clearRange}>Clear</button>
                    </div>
                </div>
            ) : null}
        </span>
    );
}

function ArchiveView({ cards, labels, onOpenCard, onRestore, onDelete }: {
    cards: KanbanCard[];
    labels: KanbanLabel[];
    onOpenCard: (id: string) => void;
    onRestore: (id: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}): JSX.Element {
    return (
        <div className="kanban-list-view kanban-archive-view kanban-view-panel">
            <section className="kanban-list-section">
                <h3><Archive size={15} /> Archived cards <small>{cards.length}</small></h3>
                {cards.map((card) => (
                    <article className="kanban-list-row" key={card.id}>
                        <button type="button" className="kanban-list-title" onClick={() => onOpenCard(card.id)}>
                            <span>{card.title}</span>
                            <small>Archived {card.archivedAt ? formatDisplayDate(card.archivedAt) : "recently"}</small>
                        </button>
                        <span className="kanban-list-labels">
                            {labels.filter((label) => card.labelIds.includes(label.id)).map((label) => <LabelChip key={label.id} label={label} />)}
                        </span>
                        <PriorityBadge priority={card.priority} />
                        <span className="kanban-date-chip"><CalendarDays size={12} /> {formatCardDateRange(card)}</span>
                        <span className="kanban-list-actions">
                            <button type="button" onClick={() => void onRestore(card.id)} aria-label={`Restore ${card.title}`}><RotateCcw size={14} /></button>
                            <button type="button" onClick={() => void onDelete(card.id)} aria-label={`Delete ${card.title}`}><Trash2 size={14} /></button>
                        </span>
                    </article>
                ))}
            </section>
        </div>
    );
}

function CardDetails({ card, cards, columns, labels, onClose, onSave, onSaveRecurrence, onDisableRecurrence, onCreateLabel, onToggleLabel }: {
    card: KanbanCard;
    cards: KanbanCard[];
    columns: KanbanColumn[];
    labels: KanbanLabel[];
    onClose: () => void;
    onSave: (cardId: string, patch: Partial<KanbanCardPatch>) => Promise<void>;
    onSaveRecurrence: (cardId: string, trigger: KanbanRecurrenceTrigger, cycle: KanbanRecurrenceCycle) => Promise<void>;
    onDisableRecurrence: (cardId: string) => Promise<void>;
    onCreateLabel: (card: KanbanCard, name: string) => Promise<void>;
    onToggleLabel: (card: KanbanCard, labelId: string) => Promise<void>;
}): JSX.Element {
    const [title, setTitle] = useState(card.title);
    const [columnId, setColumnId] = useState(card.columnId);
    const [priority, setPriority] = useState<KanbanPriority>(card.priority);
    const [startDate, setStartDate] = useState<number | null>(cardStartDate(card) ?? null);
    const [endDate, setEndDate] = useState<number | null>(cardEndDate(card) ?? null);
    const [descriptionMarkdown, setDescriptionMarkdown] = useState(card.descriptionMarkdown ?? card.descriptionText ?? "");
    const [descriptionText, setDescriptionText] = useState(card.descriptionText ?? "");
    const [subtasks, setSubtasks] = useState<KanbanSubtask[]>(card.subtasks);
    const [comments, setComments] = useState<KanbanComment[]>(card.comments);
    const [subtaskDraft, setSubtaskDraft] = useState("");
    const [commentDraft, setCommentDraft] = useState("");
    const [tagDraft, setTagDraft] = useState("");
    const [tagEditorOpen, setTagEditorOpen] = useState(false);
    const lastSavedSnapshot = useRef("");
    const selectedColumn = columns.find((column) => column.id === columnId);
    const labelSuggestions = useMemo(() => tagEditorOpen ? suggestBoardLabelsByPrefix(labels, card.labelIds, tagDraft, 5) : [], [tagEditorOpen, labels, card.labelIds, tagDraft]);
    const aiContext = useMemo(() => cardAiContext({
        ...card,
        title,
        columnId,
        priority,
        startDate: startDate ?? undefined,
        endDate: endDate ?? undefined,
        descriptionMarkdown,
        descriptionText: markdownToPlainText(descriptionMarkdown) ?? descriptionText,
        subtasks,
        comments
    }, cards, labels, columns), [card, cards, columns, comments, descriptionMarkdown, descriptionText, labels, columnId, priority, startDate, endDate, subtasks, title]);
    const subtaskSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        setTitle(card.title);
        setColumnId(card.columnId);
        setPriority(card.priority);
        setStartDate(cardStartDate(card) ?? null);
        setEndDate(cardEndDate(card) ?? null);
        setDescriptionMarkdown(card.descriptionMarkdown ?? card.descriptionText ?? "");
        setDescriptionText(card.descriptionText ?? "");
        setSubtasks(card.subtasks);
        setComments(card.comments);
        lastSavedSnapshot.current = cardDetailsSnapshot({
            title: card.title,
            columnId: card.columnId,
            priority: card.priority,
            startDate: cardStartDate(card) ?? null,
            endDate: cardEndDate(card) ?? null,
            descriptionMarkdown: card.descriptionMarkdown ?? card.descriptionText ?? "",
            descriptionText: card.descriptionText ?? "",
            subtasks: card.subtasks,
            comments: card.comments
        });
    }, [card.id, card.updatedAt]);

    useEffect(() => {
        setSubtaskDraft("");
        setCommentDraft("");
        setTagDraft("");
        setTagEditorOpen(false);
    }, [card.id]);

    useEffect(() => {
        const snapshot = cardDetailsSnapshot({ title, columnId, priority, startDate, endDate, descriptionMarkdown, descriptionText, subtasks, comments });
        if (!lastSavedSnapshot.current) {
            lastSavedSnapshot.current = snapshot;
            return;
        }
        if (snapshot === lastSavedSnapshot.current) return;
        const timeout = window.setTimeout(() => {
            lastSavedSnapshot.current = snapshot;
            void onSave(card.id, {
                title,
                columnId,
                priority,
                startDate,
                endDate,
                descriptionMarkdown,
                descriptionText,
                subtasks,
                comments
            }).catch(() => {
                lastSavedSnapshot.current = "";
            });
        }, 650);
        return () => window.clearTimeout(timeout);
    }, [card.id, title, columnId, priority, startDate, endDate, descriptionMarkdown, descriptionText, subtasks, comments, onSave]);

    function addSubtask(): void {
        const nextTitle = subtaskDraft.trim();
        if (!nextTitle) return;
        const now = Date.now();
        setSubtasks((current) => [...current, { id: crypto.randomUUID(), title: nextTitle, completed: false, createdAt: now, updatedAt: now }]);
        setSubtaskDraft("");
    }

    function updateSubtask(id: string, patch: Partial<Pick<KanbanSubtask, "title" | "completed">>): void {
        const now = Date.now();
        setSubtasks((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: now } : item));
    }

    function deleteSubtask(id: string): void {
        setSubtasks((current) => current.filter((item) => item.id !== id));
    }

    function handleSubtaskDragEnd(event: DragEndEvent): void {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : "";
        if (!overId || activeId === overId) return;
        setSubtasks((current) => {
            const oldIndex = current.findIndex((item) => item.id === activeId);
            const newIndex = current.findIndex((item) => item.id === overId);
            if (oldIndex < 0 || newIndex < 0) return current;
            const now = Date.now();
            return arrayMove(current, oldIndex, newIndex).map((item) => item.id === activeId ? { ...item, updatedAt: now } : item);
        });
    }

    function addComment(draft = commentDraft): void {
        const body = draft.trim();
        if (!body) return;
        const now = Date.now();
        setComments((current) => [...current, { id: crypto.randomUUID(), body, createdAt: now, updatedAt: now }]);
        setCommentDraft("");
    }

    function deleteComment(id: string): void {
        setComments((current) => current.filter((item) => item.id !== id));
    }

    function createTag(): void {
        const name = tagDraft.trim();
        if (!name) return;
        setTagDraft("");
        setTagEditorOpen(false);
        void onCreateLabel(card, name);
    }

    function applyLabelSuggestion(suggestion: AiLabelSuggestion): void {
        setTagDraft("");
        setTagEditorOpen(false);
        if (suggestion.existingLabelId && !card.labelIds.includes(suggestion.existingLabelId)) {
            void onToggleLabel(card, suggestion.existingLabelId);
            return;
        }
        void onCreateLabel(card, suggestion.name);
    }

    return (
        <aside className="kanban-details" aria-label="Card details">
            <header className="kanban-details-header">
                <label className="kanban-title-label">
                    <input
                        className="kanban-title-input"
                        aria-label="Card title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                    />
                    <span>Updated {formatDisplayDate(card.updatedAt)}</span>
                </label>
                <button type="button" onClick={onClose} aria-label="Close details"><X size={16} /></button>
            </header>
            <div className="kanban-details-body">
                <section className="kanban-detail-section">
                    <h4>Date Range</h4>
                    <div className="kanban-detail-date-row">
                        <DateRangePicker
                            className="kanban-detail-control kanban-date-control"
                            ariaLabel="Choose date range"
                            startDate={startDate}
                            endDate={endDate}
                            onChange={(nextStartDate, nextEndDate) => {
                                setStartDate(nextStartDate);
                                setEndDate(nextEndDate);
                            }}
                        />
                        <RecurrenceControl card={card} onSave={(trigger, cycle) => onSaveRecurrence(card.id, trigger, cycle)} onDisable={() => onDisableRecurrence(card.id)} />
                    </div>
                </section>
                <section className="kanban-detail-section">
                    <h4>Category</h4>
                    <div className="kanban-detail-grid">
                        <CustomSelect label="Priority" value={priority} options={priorities.map((item) => ({ value: item, label: item }))} icon={<Flag size={14} />} showLabel={false} onChange={(value) => setPriority(value as KanbanPriority)} />
                        <CustomSelect label="Column" value={columnId} options={columns.map((column) => ({ value: column.id, label: column.name }))} icon={<span className="kanban-column-color-dot" style={{ background: selectedColumn?.color ?? "var(--kanban-primary)" }} />} showLabel={false} onChange={setColumnId} />
                    </div>
                </section>
                <section className="kanban-detail-section kanban-detail-description">
                    <h4>Description</h4>
                    <CompletionMarkdownTextarea
                        value={descriptionMarkdown}
                        ariaLabel="Card description"
                        minChars={5}
                        maxChars={50}
                        field="description"
                        context={aiContext}
                        onChange={(value) => {
                            setDescriptionMarkdown(value);
                            setDescriptionText(markdownToPlainText(value) ?? "");
                        }}
                    />
                </section>
                <section className="kanban-detail-section">
                    <h4>Subtasks</h4>
                    <div className="kanban-subtasks">
                        <DndContext sensors={subtaskSensors} collisionDetection={closestCenter} onDragEnd={handleSubtaskDragEnd}>
                            <SortableContext items={subtasks.map((subtask) => subtask.id)} strategy={verticalListSortingStrategy}>
                                {subtasks.map((subtask) => (
                                    <SortableSubtask
                                        key={subtask.id}
                                        subtask={subtask}
                                        onUpdate={updateSubtask}
                                        onDelete={deleteSubtask}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                        <form className="kanban-inline-add kanban-subtask-add" onSubmit={(event) => { event.preventDefault(); addSubtask(); }}>
                            <input value={subtaskDraft} onChange={(event) => setSubtaskDraft(event.target.value)} placeholder="Add subtask" aria-label="Add subtask" />
                        </form>
                    </div>
                </section>
                <section className="kanban-detail-section">
                    <h4>Tags</h4>
                    <div className="kanban-tags">
                        {labels.filter((label) => card.labelIds.includes(label.id)).map((label) => (
                            <button type="button" key={label.id} className="kanban-tag-pill" onClick={() => void onToggleLabel(card, label.id)}>
                                <LabelChip label={label} />
                            </button>
                        ))}
                        {tagEditorOpen ? (
                            <span className="kanban-tag-suggest-wrap">
                                <form className="kanban-tag-input-pill" onSubmit={(event) => { event.preventDefault(); createTag(); }}>
                                    <input autoFocus value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="Tag" onBlur={() => { if (!tagDraft.trim()) setTagEditorOpen(false); }} />
                                </form>
                                {labelSuggestions.length > 0 ? (
                                    <span className="kanban-tag-suggestions" aria-label="Suggested tags">
                                        {labelSuggestions.map((suggestion) => (
                                            <button
                                                type="button"
                                                key={`${suggestion.existingLabelId ?? "new"}:${suggestion.name}`}
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => applyLabelSuggestion(suggestion)}
                                            >
                                                {suggestion.name}
                                            </button>
                                        ))}
                                    </span>
                                ) : null}
                            </span>
                        ) : (
                            <button type="button" className="kanban-tag-add" aria-label="Add tag" onClick={() => setTagEditorOpen(true)}><Plus size={13} /></button>
                        )}
                    </div>
                </section>
                <section className="kanban-detail-section">
                    <h4>Comments</h4>
                    <div className="kanban-comments">
                        {comments.map((comment) => (
                            <article className="kanban-comment" key={comment.id}>
                                <MarkdownBlock markdown={comment.body} />
                                <div>
                                    <span>{formatDisplayDate(comment.createdAt)}</span>
                                    <button type="button" onClick={() => deleteComment(comment.id)} aria-label="Delete comment"><Trash2 size={13} /></button>
                                </div>
                            </article>
                        ))}
                        <form className="kanban-comment-form" onSubmit={(event) => { event.preventDefault(); addComment(); }}>
                            <CompletionMarkdownTextarea
                                value={commentDraft}
                                ariaLabel="Comment"
                                minChars={5}
                                maxChars={50}
                                field="comment"
                                context={aiContext}
                                onChange={setCommentDraft}
                                onSubmit={() => addComment()}
                            />
                            <button type="submit" disabled={!commentDraft.trim()}><Plus size={13} /> Add comment</button>
                        </form>
                    </div>
                </section>
            </div>
        </aside>
    );
}

function RecurrenceControl({ card, onSave, onDisable }: {
    card: KanbanCard;
    onSave: (trigger: KanbanRecurrenceTrigger, cycle: KanbanRecurrenceCycle) => Promise<void>;
    onDisable: () => Promise<void>;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const [trigger, setTrigger] = useState<KanbanRecurrenceTrigger>(card.recurrence?.trigger ?? "completion");
    const [cycle, setCycle] = useState<KanbanRecurrenceCycle>(card.recurrence?.cycle ?? "daily");
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setTrigger(card.recurrence?.trigger ?? "completion");
        setCycle(card.recurrence?.cycle ?? "daily");
        setError(null);
    }, [card.id, card.recurrence?.trigger, card.recurrence?.cycle]);

    async function commit(): Promise<void> {
        setPending(true);
        try {
            await onSave(trigger, cycle);
            setOpen(false);
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setPending(false);
        }
    }

    async function disable(): Promise<void> {
        if (!card.recurrence) return;
        setPending(true);
        try {
            await onDisable();
            setOpen(false);
            setError(null);
        } catch (caught) {
            setError(errorMessage(caught));
        } finally {
            setPending(false);
        }
    }

    const summary = recurrenceSummary(card);
    return (
        <span
            className={`kanban-recurrence-control ${card.recurrence ? "has-clear" : ""}`}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
        >
            <button type="button" className={`kanban-recurrence-trigger ${card.recurrence?.status === "blocked" ? "blocked" : ""}`} onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label="周期设置">
                {card.recurrence?.status === "blocked" ? <AlertTriangle size={14} /> : <Repeat2 size={14} />}
                <span>{card.recurrence ? summary : "周期"}</span>
            </button>
            {card.recurrence ? (
                <button
                    type="button"
                    className="kanban-recurrence-clear"
                    aria-label="取消周期"
                    title="取消周期"
                    disabled={pending}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); void disable(); }}
                >
                    <X size={13} />
                </button>
            ) : null}
            {open ? (
                <div className="kanban-recurrence-popover" role="dialog" aria-label="周期设置">
                    <div className="kanban-recurrence-popover-title">
                        <strong>{card.recurrence ? "周期" : "开启周期"}</strong>
                        <span>{card.recurrence ? summary : "基于当前卡片创建后续卡片"}</span>
                    </div>
                    {card.recurrence?.status === "blocked" ? <p className="kanban-recurrence-warning">{card.recurrence.blockedReason ?? "需要处理"}</p> : null}
                    <div className="kanban-recurrence-selects">
                        <CustomSelect
                            label="触发方式"
                            value={trigger}
                            options={recurrenceTriggers.map((item) => ({ value: item, label: recurrenceTriggerLabel(item) }))}
                            icon={<Repeat2 size={14} />}
                            onChange={(value) => setTrigger(value as KanbanRecurrenceTrigger)}
                        />
                        <CustomSelect
                            label="周期"
                            value={cycle}
                            options={recurrenceCycles.map((item) => ({ value: item, label: recurrenceCycleLabel(item) }))}
                            icon={<CalendarDays size={14} />}
                            onChange={(value) => setCycle(value as KanbanRecurrenceCycle)}
                        />
                    </div>
                    <small>{trigger === "fixed" ? "到周期后静默创建下一张卡片。" : "当前卡片进入完成列后立即创建下一张卡片。"}</small>
                    {error ? <p className="kanban-recurrence-warning">{error}</p> : null}
                    <button type="button" onClick={() => void commit()} disabled={pending}>
                        {pending ? "保存中..." : card.recurrence ? "保存周期" : "开启周期"}
                    </button>
                </div>
            ) : null}
        </span>
    );
}

function SortableSubtask({
    subtask,
    onUpdate,
    onDelete
}: {
    subtask: KanbanSubtask;
    onUpdate: (id: string, patch: Partial<Pick<KanbanSubtask, "title" | "completed">>) => void;
    onDelete: (id: string) => void;
}): JSX.Element {
    const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: subtask.id });

    return (
        <div
            ref={setNodeRef}
            className={`kanban-subtask-row ${isDragging ? "dragging" : ""}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
        >
            <input
                type="checkbox"
                checked={subtask.completed}
                onChange={(event) => onUpdate(subtask.id, { completed: event.target.checked })}
                aria-label={`Complete ${subtask.title || "subtask"}`}
            />
            <input
                value={subtask.title}
                onChange={(event) => onUpdate(subtask.id, { title: event.target.value })}
                onKeyDown={(event) => {
                    if ((event.key === "Delete" || event.key === "Backspace") && event.currentTarget.value.trim().length === 0) {
                        event.preventDefault();
                        onDelete(subtask.id);
                    }
                }}
                aria-label="Subtask title"
            />
            <button
                type="button"
                className="kanban-subtask-handle"
                aria-label={`Drag ${subtask.title || "subtask"}`}
                {...attributes}
                {...listeners}
            >
                <Menu size={18} strokeWidth={2.1} />
            </button>
        </div>
    );
}

function CustomSelect({ label, value, options, icon, showLabel = true, onChange }: {
    label: string;
    value: string;
    options: SelectOption[];
    icon?: ReactNode;
    showLabel?: boolean;
    onChange: (value: string) => void;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const selected = options.find((option) => option.value === value) ?? options[0];

    return (
        <div
            className={`kanban-select ${open ? "open" : ""}`}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
        >
            {showLabel ? <span className="kanban-select-label">{label}</span> : null}
            <button type="button" className="kanban-select-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
                <span className="kanban-select-value">{icon}<span>{selected?.label ?? "Select"}</span></span>
                <ChevronDown size={14} />
            </button>
            {open ? (
                <div className="kanban-select-menu" role="listbox" aria-label={label}>
                    {options.map((option) => (
                        <button
                            type="button"
                            key={option.value}
                            className={option.value === value ? "active" : ""}
                            role="option"
                            aria-selected={option.value === value}
                            onClick={() => { onChange(option.value); setOpen(false); }}
                        >
                            <span>{option.label}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function MarkdownTextarea({ value, ariaLabel, onChange, onSubmit }: {
    value: string;
    ariaLabel: string;
    onChange: (value: string) => void;
    onSubmit?: () => void;
}): JSX.Element {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    useAutoGrowTextarea(ref, value);

    return (
        <textarea
            ref={ref}
            className="kanban-markdown-textarea"
            value={value}
            aria-label={ariaLabel}
            spellCheck
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
                if (!onSubmit || !isMarkdownSubmitShortcut(event)) return;
                event.preventDefault();
                onSubmit();
            }}
        />
    );
}

function CompletionMarkdownTextarea({ value, ariaLabel, minChars, maxChars, field, context, onChange, onSubmit }: {
    value: string;
    ariaLabel: string;
    minChars: number;
    maxChars: number;
    field: AiTextSuggestionField;
    context: AiSuggestionCardContext;
    onChange: (value: string) => void;
    onSubmit?: () => void;
}): JSX.Element {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const { suggestion, cursor, refreshCursor, clearSuggestion, focusCompletion, blurCompletion, acceptSuggestion } = useInlineCompletion({ value, minChars, maxChars, field, context, elementRef: ref });
    useAutoGrowTextarea(ref, value);

    return (
        <span className="kanban-completion-wrap textarea">
            <textarea
                ref={ref}
                className="kanban-markdown-textarea"
                value={value}
                aria-label={ariaLabel}
                spellCheck
                onFocus={focusCompletion}
                onBlur={blurCompletion}
                onChange={(event) => { clearSuggestion(); onChange(event.target.value); }}
                onSelect={refreshCursor}
                onClick={refreshCursor}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                onKeyDown={(event) => {
                    if (event.key === "Tab" && suggestion) {
                        event.preventDefault();
                        const nextValue = acceptSuggestion();
                        if (nextValue !== null) onChange(nextValue);
                        return;
                    }
                    if (!onSubmit || !isMarkdownSubmitShortcut(event)) return;
                    event.preventDefault();
                    onSubmit();
                }}
            />
            {suggestion ? <span className="kanban-completion-ghost textarea" style={{ transform: `translateY(${-scrollTop}px)` }} aria-hidden="true"><span>{cursor.before}</span><strong>{suggestion}</strong></span> : null}
        </span>
    );
}

function useAutoGrowTextarea(elementRef: MutableRefObject<HTMLTextAreaElement | null>, value: string): void {
    useLayoutEffect(() => {
        const element = elementRef.current;
        if (!element) return;
        element.style.height = "0px";
        element.style.height = `${element.scrollHeight}px`;
    }, [elementRef, value]);
}

function useInlineCompletion<TElement extends HTMLInputElement | HTMLTextAreaElement>({ value, minChars, maxChars, field, context, elementRef }: {
    value: string;
    minChars: number;
    maxChars: number;
    field: AiTextSuggestionField;
    context: AiSuggestionCardContext;
    elementRef: MutableRefObject<TElement | null>;
}): {
    suggestion: string;
    cursor: CursorText;
    refreshCursor: () => void;
    clearSuggestion: () => void;
    focusCompletion: () => void;
    blurCompletion: () => void;
    acceptSuggestion: () => string | null;
} {
    const [suggestion, setSuggestion] = useState("");
    const [cursor, setCursor] = useState<CursorText>({ before: value, after: "" });
    const [focused, setFocused] = useState(false);
    const [requestTick, setRequestTick] = useState(0);
    const requestIdRef = useRef(0);
    const contextRef = useRef(context);

    useEffect(() => {
        contextRef.current = context;
    }, [context]);

    function currentCursor(): CursorText {
        const element = elementRef.current;
        const start = element?.selectionStart ?? value.length;
        const end = element?.selectionEnd ?? start;
        return { before: value.slice(0, start), after: value.slice(end) };
    }

    function refreshCursor(): void {
        setSuggestion("");
        setCursor(currentCursor());
        requestIdRef.current += 1;
        if (focused) setRequestTick((current) => current + 1);
    }

    function clearSuggestion(): void {
        setSuggestion("");
        requestIdRef.current += 1;
    }

    function focusCompletion(): void {
        setFocused(true);
        setCursor(currentCursor());
        setSuggestion("");
        requestIdRef.current += 1;
        setRequestTick((current) => current + 1);
    }

    function blurCompletion(): void {
        setFocused(false);
        setSuggestion("");
        requestIdRef.current += 1;
    }

    function acceptSuggestion(): string | null {
        if (!suggestion) return null;
        const nextValue = `${cursor.before}${suggestion}${cursor.after}`;
        setSuggestion("");
        requestIdRef.current += 1;
        window.requestAnimationFrame(() => {
            const nextPosition = cursor.before.length + suggestion.length;
            elementRef.current?.setSelectionRange(nextPosition, nextPosition);
        });
        return nextValue;
    }

    useEffect(() => {
        const nextCursor = currentCursor();
        setCursor(nextCursor);
        setSuggestion("");
        const activeRequestId = requestIdRef.current + 1;
        requestIdRef.current = activeRequestId;
        if (!shouldRequestInlineCompletion(nextCursor.before, nextCursor.after, minChars, focused)) return;
        const requestedCursor = nextCursor;
        const timeout = window.setTimeout(() => {
            void getApi().ai.suggestText({ field, textBeforeCursor: nextCursor.before, textAfterCursor: nextCursor.after, maxChars, context: contextRef.current })
                .then((result) => {
                    const liveCursor = currentCursor();
                    if (requestIdRef.current === activeRequestId && shouldApplyInlineCompletion(requestedCursor, liveCursor, minChars, focused)) {
                        setSuggestion(result.suggestion ?? "");
                    }
                })
                .catch(() => {
                    if (requestIdRef.current === activeRequestId) setSuggestion("");
                });
        }, 500);
        return () => window.clearTimeout(timeout);
    }, [value, minChars, maxChars, field, elementRef, focused, requestTick]);

    return { suggestion, cursor, refreshCursor, clearSuggestion, focusCompletion, blurCompletion, acceptSuggestion };
}

function MarkdownBlock({ markdown }: { markdown: string }): JSX.Element {
    return (
        <div className="kanban-markdown-body">
            <ReactMarkdown>{markdown}</ReactMarkdown>
        </div>
    );
}

function RichTextEditor({ value, onChange, onSubmit, enableMarkdownLinks = false }: {
    value?: KanbanRichTextDocument;
    onChange: (json: KanbanRichTextDocument, text: string) => void;
    onSubmit?: RichTextSubmitHandler;
    enableMarkdownLinks?: boolean;
}): JSX.Element {
    const pendingValueRef = useRef<JSONContent | null>(null);
    const onChangeRef = useRef(onChange);
    const onSubmitRef = useRef<RichTextSubmitHandler | undefined>(onSubmit);
    const editorRef = useRef<Editor | null>(null);

    useEffect(() => {
        onChangeRef.current = onChange;
        onSubmitRef.current = onSubmit;
    }, [onChange, onSubmit]);

    const editor = useEditor({
        extensions: [StarterKit],
        content: (value as JSONContent | undefined) ?? { type: "doc", content: [{ type: "paragraph" }] },
        editorProps: {
            attributes: { class: "kanban-editor-content" },
            handlePaste: (view, event) => {
                const currentEditor = editorRef.current;
                if (!enableMarkdownLinks || !currentEditor) return false;
                const pastedText = event.clipboardData?.getData("text/plain") ?? "";
                const linkTarget = resolveRichTextLinkPaste(pastedText);
                if (!linkTarget) return false;
                event.preventDefault();
                return insertRichTextLink(currentEditor, { from: view.state.selection.from, to: view.state.selection.to }, linkTarget);
            },
            handleTextInput: (view, from, to, text) => {
                const currentEditor = editorRef.current;
                if (!enableMarkdownLinks || !currentEditor || text !== ")") return false;
                const resolvedPosition = view.state.doc.resolve(from);
                const textBeforeCursor = resolvedPosition.parent.textBetween(0, resolvedPosition.parentOffset, undefined, "\ufffc") + text;
                const markdownLink = findRichTextMarkdownLinkSuffix(textBeforeCursor);
                if (!markdownLink) return false;
                return insertRichTextLink(
                    currentEditor,
                    { from: resolvedPosition.start() + markdownLink.start, to },
                    { label: markdownLink.label, url: markdownLink.url, selectLabel: false }
                );
            },
            handleKeyDown: (view, event) => {
                const currentEditor = editorRef.current;
                if (currentEditor && isRichTextListIndentShortcut(event) && isRichTextListActive(currentEditor)) {
                    const handled = applyRichTextListIndentation(currentEditor, event.shiftKey);
                    if (handled) {
                        event.preventDefault();
                        return true;
                    }
                    return false;
                }
                if (currentEditor && isRichTextListContinuationShortcut(event) && isRichTextListActive(currentEditor)) {
                    const handled = applyRichTextListContinuation(currentEditor);
                    if (handled) {
                        event.preventDefault();
                        return true;
                    }
                    return false;
                }
                if (!onSubmitRef.current || !isRichTextSubmitShortcut(event)) return false;
                event.preventDefault();
                onSubmitRef.current(view.state.doc.toJSON() as KanbanRichTextDocument, currentEditor?.getText() ?? "");
                view.dom.blur();
                return true;
            }
        },
        onUpdate: ({ editor: current }) => onChangeRef.current(current.getJSON() as KanbanRichTextDocument, current.getText()),
        onBlur: ({ editor: current }) => {
            const pending = pendingValueRef.current;
            if (pending !== null) {
                pendingValueRef.current = null;
                if (shouldSyncRichTextEditorContent(current.getJSON(), pending)) {
                    current.commands.setContent(pending, { emitUpdate: false });
                }
            }
        }
    });
    editorRef.current = editor;

    useEffect(() => {
        if (!editor) return;
        const newValue = (value as JSONContent | undefined) ?? { type: "doc", content: [{ type: "paragraph" }] };
        if (editor.isFocused) {
            pendingValueRef.current = newValue;
            return;
        }
        pendingValueRef.current = null;
        if (shouldSyncRichTextEditorContent(editor.getJSON(), newValue)) {
            editor.commands.setContent(newValue, { emitUpdate: false });
        }
    }, [editor, value]);

    return (
        <div className="kanban-editor">
            <EditorContent editor={editor} />
        </div>
    );
}

function insertRichTextLink(editor: Editor, range: { from: number; to: number }, linkTarget: RichTextLinkInsertTarget): boolean {
    const commandChain = editor
        .chain()
        .focus()
        .insertContentAt(range, {
            type: "text",
            text: linkTarget.label,
            marks: [{ type: "link", attrs: { href: linkTarget.url } }]
        });

    if (linkTarget.selectLabel) {
        commandChain.setTextSelection({ from: range.from, to: range.from + linkTarget.label.length });
    }

    return commandChain.run();
}

function PriorityBadge({ priority }: { priority: KanbanPriority }): JSX.Element {
    return <span className={`kanban-priority priority-${priority}`}>{priority}</span>;
}

function RecurrenceBadge({ card, compact = false }: { card: KanbanCard; compact?: boolean }): JSX.Element | null {
    if (!card.recurrence) return null;
    const blocked = card.recurrence.status === "blocked";
    const title = recurrenceSummary(card);
    return (
        <span className={`kanban-recurrence-badge ${blocked ? "blocked" : ""} ${compact ? "compact" : ""}`} title={title} aria-label={title}>
            {blocked ? <AlertTriangle size={12} /> : <Repeat2 size={12} />}
            {compact ? null : <span>{title}</span>}
        </span>
    );
}

function LabelChip({ label }: { label: KanbanLabel }): JSX.Element {
    return <span className="kanban-label-chip" style={{ borderColor: label.color, color: label.color }}>{label.name}</span>;
}

function recurrenceTriggerLabel(trigger: KanbanRecurrenceTrigger): string {
    return trigger === "fixed" ? "固定时间" : "完成后";
}

function recurrenceCycleLabel(cycle: KanbanRecurrenceCycle): string {
    if (cycle === "daily") return "每日";
    if (cycle === "weekly") return "每周";
    return "每月";
}

function cardDetailsSnapshot(value: {
    title: string;
    columnId: string;
    priority: KanbanPriority;
    startDate: number | null;
    endDate: number | null;
    descriptionMarkdown: string;
    descriptionText: string;
    subtasks: KanbanSubtask[];
    comments: KanbanComment[];
}): string {
    return JSON.stringify(value);
}

interface CalendarCell {
    day: number;
    month: number;
    year: number;
    otherMonth: boolean;
}

function calendarCells(year: number, month: number): CalendarCell[] {
    const cells: CalendarCell[] = [];
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const previousMonthDays = new Date(year, month, 0).getDate();

    for (let index = firstWeekday - 1; index >= 0; index -= 1) {
        const date = new Date(year, month - 1, previousMonthDays - index);
        cells.push({ day: date.getDate(), month: date.getMonth(), year: date.getFullYear(), otherMonth: true });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        cells.push({ day, month, year, otherMonth: false });
    }
    while (cells.length % 7 !== 0) {
        const date = new Date(year, month + 1, cells.length - firstWeekday - daysInMonth + 1);
        cells.push({ day: date.getDate(), month: date.getMonth(), year: date.getFullYear(), otherMonth: true });
    }

    return cells;
}

function dateOnlyTimestamp(year: number, month: number, day: number): number {
    return new Date(year, month, day).getTime();
}

function todayTimestamp(): number {
    const today = new Date();
    return dateOnlyTimestamp(today.getFullYear(), today.getMonth(), today.getDate());
}

function formatDisplayDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function cardStartDate(card: KanbanCard): number | undefined {
    return card.startDate ?? card.dueDate;
}

function cardEndDate(card: KanbanCard): number | undefined {
    return card.endDate ?? (card.startDate === undefined ? card.dueDate : undefined);
}

function formatCardDateRange(card: KanbanCard): string {
    return formatDateRange(cardStartDate(card), cardEndDate(card));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
