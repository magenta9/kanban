import { useEffect, useRef, useState } from "react";
import { isAgentRunComment } from "@kanban/shared";
import type { KanbanCard, KanbanCardPatch, KanbanComment, KanbanPriority, KanbanRichTextDocument, KanbanSubtask } from "@kanban/shared";

export interface CardEditSnapshot {
    title: string;
    columnId: string;
    priority: KanbanPriority;
    startDate: number | null;
    endDate: number | null;
    descriptionMarkdown?: string;
    descriptionJson?: KanbanRichTextDocument;
    descriptionText: string;
    subtasks: KanbanSubtask[];
    comments: KanbanComment[];
}

export interface CardEditingState extends CardEditSnapshot {
    updateTitle: (title: string) => void;
    moveToColumn: (columnId: string) => void;
    updatePriority: (priority: KanbanPriority) => void;
    updateDateRange: (startDate: number | null, endDate: number | null) => void;
    updateDescription: (input: { markdown?: string; json?: KanbanRichTextDocument; text: string }) => void;
    addSubtask: (title: string) => boolean;
    updateSubtask: (id: string, patch: Partial<Pick<KanbanSubtask, "title" | "completed">>) => void;
    deleteSubtask: (id: string) => void;
    reorderSubtask: (activeId: string, overId: string) => void;
    addComment: (body: string) => boolean;
    deleteComment: (id: string) => void;
}

export function cardEditSnapshotFromCard(card: KanbanCard): CardEditSnapshot {
    return {
        title: card.title,
        columnId: card.columnId,
        priority: card.priority,
        startDate: cardEditStartDate(card) ?? null,
        endDate: cardEditEndDate(card) ?? null,
        descriptionMarkdown: card.descriptionMarkdown,
        descriptionJson: card.descriptionJson ?? richTextDocumentFromPlainText(card.descriptionMarkdown ?? card.descriptionText ?? ""),
        descriptionText: card.descriptionText ?? "",
        subtasks: card.subtasks,
        comments: card.comments
    };
}

function cardEditStartDate(card: KanbanCard): number | undefined {
    return card.startDate ?? card.dueDate;
}

function cardEditEndDate(card: KanbanCard): number | undefined {
    return card.endDate ?? (card.startDate === undefined ? card.dueDate : undefined);
}

export function cardEditSnapshotKey(value: CardEditSnapshot): string {
    return JSON.stringify(value);
}

export function cardEditPatch(snapshot: CardEditSnapshot): Partial<KanbanCardPatch> {
    return {
        title: snapshot.title,
        columnId: snapshot.columnId,
        priority: snapshot.priority,
        startDate: snapshot.startDate,
        endDate: snapshot.endDate,
        descriptionMarkdown: snapshot.descriptionMarkdown,
        descriptionJson: snapshot.descriptionJson,
        descriptionText: snapshot.descriptionText,
        subtasks: snapshot.subtasks,
        comments: snapshot.comments
    };
}

export function useCardEditingState({
    card,
    onSave,
    saveDelayMs = 650
}: {
    card: KanbanCard;
    onSave: (cardId: string, patch: Partial<KanbanCardPatch>) => Promise<void>;
    saveDelayMs?: number;
}): CardEditingState {
    const initialSnapshot = cardEditSnapshotFromCard(card);
    const [title, setTitle] = useState(initialSnapshot.title);
    const [columnId, setColumnId] = useState(initialSnapshot.columnId);
    const [priority, setPriority] = useState<KanbanPriority>(initialSnapshot.priority);
    const [startDate, setStartDate] = useState<number | null>(initialSnapshot.startDate);
    const [endDate, setEndDate] = useState<number | null>(initialSnapshot.endDate);
    const [descriptionMarkdown, setDescriptionMarkdown] = useState<string | undefined>(initialSnapshot.descriptionMarkdown);
    const [descriptionJson, setDescriptionJson] = useState<KanbanRichTextDocument | undefined>(initialSnapshot.descriptionJson);
    const [descriptionText, setDescriptionText] = useState(initialSnapshot.descriptionText);
    const [subtasks, setSubtasks] = useState<KanbanSubtask[]>(initialSnapshot.subtasks);
    const [comments, setComments] = useState<KanbanComment[]>(initialSnapshot.comments);
    const cardId = useRef(card.id);
    const baseComments = useRef(initialSnapshot.comments);
    const lastSavedSnapshot = useRef(cardEditSnapshotKey(initialSnapshot));

    function snapshotFromState(): CardEditSnapshot {
        return {
            title,
            columnId,
            priority,
            startDate,
            endDate,
            descriptionMarkdown,
            descriptionJson,
            descriptionText,
            subtasks,
            comments
        };
    }

    useEffect(() => {
        const nextSnapshot = cardEditSnapshotFromCard(card);
        const currentSnapshot = snapshotFromState();
        const reconciledSnapshot = card.id === cardId.current
            ? {
                ...currentSnapshot,
                comments: reconcileAgentRunComments(baseComments.current, currentSnapshot.comments, nextSnapshot.comments)
            }
            : nextSnapshot;

        cardId.current = card.id;
        baseComments.current = nextSnapshot.comments;
        setTitle(reconciledSnapshot.title);
        setColumnId(reconciledSnapshot.columnId);
        setPriority(reconciledSnapshot.priority);
        setStartDate(reconciledSnapshot.startDate);
        setEndDate(reconciledSnapshot.endDate);
        setDescriptionMarkdown(reconciledSnapshot.descriptionMarkdown);
        setDescriptionJson(reconciledSnapshot.descriptionJson);
        setDescriptionText(reconciledSnapshot.descriptionText);
        setSubtasks(reconciledSnapshot.subtasks);
        setComments(reconciledSnapshot.comments);
        lastSavedSnapshot.current = cardEditSnapshotKey(nextSnapshot);
    }, [card.id, card.updatedAt]);

    useEffect(() => {
        const snapshot = snapshotFromState();
        const snapshotKey = cardEditSnapshotKey(snapshot);
        if (snapshotKey === lastSavedSnapshot.current) return;
        const timeout = window.setTimeout(() => {
            baseComments.current = snapshot.comments;
            lastSavedSnapshot.current = snapshotKey;
            void onSave(card.id, cardEditPatch(snapshot)).catch(() => {
                lastSavedSnapshot.current = "";
            });
        }, saveDelayMs);
        return () => window.clearTimeout(timeout);
    }, [card.id, title, columnId, priority, startDate, endDate, descriptionMarkdown, descriptionJson, descriptionText, subtasks, comments, onSave, saveDelayMs]);

    function addSubtask(nextTitle: string): boolean {
        const trimmedTitle = nextTitle.trim();
        if (!trimmedTitle) return false;
        const now = Date.now();
        setSubtasks((current) => [...current, { id: crypto.randomUUID(), title: trimmedTitle, completed: false, createdAt: now, updatedAt: now }]);
        return true;
    }

    function updateSubtask(id: string, patch: Partial<Pick<KanbanSubtask, "title" | "completed">>): void {
        const now = Date.now();
        setSubtasks((current) => current.map((item) => item.id === id ? { ...item, ...patch, updatedAt: now } : item));
    }

    function deleteSubtask(id: string): void {
        setSubtasks((current) => current.filter((item) => item.id !== id));
    }

    function reorderSubtask(activeId: string, overId: string): void {
        if (!overId || activeId === overId) return;
        setSubtasks((current) => {
            const oldIndex = current.findIndex((item) => item.id === activeId);
            const newIndex = current.findIndex((item) => item.id === overId);
            if (oldIndex < 0 || newIndex < 0) return current;
            const now = Date.now();
            return moveItem(current, oldIndex, newIndex).map((item) => item.id === activeId ? { ...item, updatedAt: now } : item);
        });
    }

    function addComment(nextBody: string): boolean {
        const body = nextBody.trim();
        if (!body) return false;
        const now = Date.now();
        setComments((current) => [...current, { id: crypto.randomUUID(), body, createdAt: now, updatedAt: now }]);
        return true;
    }

    function deleteComment(id: string): void {
        setComments((current) => current.filter((item) => item.id !== id));
    }

    function updateDescription(input: { markdown?: string; json?: KanbanRichTextDocument; text: string }): void {
        setDescriptionMarkdown(input.markdown);
        setDescriptionJson(input.json);
        setDescriptionText(input.text);
    }

    return {
        title,
        columnId,
        priority,
        startDate,
        endDate,
        descriptionMarkdown,
        descriptionJson,
        descriptionText,
        subtasks,
        comments,
        updateTitle: setTitle,
        moveToColumn: setColumnId,
        updatePriority: setPriority,
        updateDateRange: (nextStartDate, nextEndDate) => {
            setStartDate(nextStartDate);
            setEndDate(nextEndDate);
        },
        updateDescription,
        addSubtask,
        updateSubtask,
        deleteSubtask,
        reorderSubtask,
        addComment,
        deleteComment
    };
}

function reconcileAgentRunComments(base: KanbanComment[], current: KanbanComment[], next: KanbanComment[]): KanbanComment[] {
    if (areCommentsEqual(base, current)) return next;
    const baseIds = new Set(base.map((item) => item.id));
    const currentIds = new Set(current.map((item) => item.id));
    const externalAdditions = next.filter((item) => !baseIds.has(item.id) && !currentIds.has(item.id) && isAgentRunComment(item));
    return externalAdditions.length > 0 ? [...current, ...externalAdditions] : current;
}

function areCommentsEqual(left: KanbanComment[], right: KanbanComment[]): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function richTextDocumentFromPlainText(value: string): KanbanRichTextDocument | undefined {
    const trimmedValue = value.trim();
    if (!trimmedValue) return undefined;
    return {
        type: "doc",
        content: trimmedValue.split(/\n{2,}/).map((block) => ({
            type: "paragraph",
            content: [{ type: "text", text: block.trim() }]
        }))
    };
}

function moveItem<TItem>(items: TItem[], oldIndex: number, newIndex: number): TItem[] {
    const nextItems = items.slice();
    const [item] = nextItems.splice(oldIndex, 1);
    if (item === undefined) return items;
    nextItems.splice(newIndex, 0, item);
    return nextItems;
}
