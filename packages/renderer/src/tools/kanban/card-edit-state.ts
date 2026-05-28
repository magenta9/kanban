import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
    setTitle: Dispatch<SetStateAction<string>>;
    setColumnId: Dispatch<SetStateAction<string>>;
    setPriority: Dispatch<SetStateAction<KanbanPriority>>;
    setStartDate: Dispatch<SetStateAction<number | null>>;
    setEndDate: Dispatch<SetStateAction<number | null>>;
    setDescriptionMarkdown: Dispatch<SetStateAction<string | undefined>>;
    setDescriptionJson: Dispatch<SetStateAction<KanbanRichTextDocument | undefined>>;
    setDescriptionText: Dispatch<SetStateAction<string>>;
    setSubtasks: Dispatch<SetStateAction<KanbanSubtask[]>>;
    setComments: Dispatch<SetStateAction<KanbanComment[]>>;
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
    const lastSavedSnapshot = useRef(cardEditSnapshotKey(initialSnapshot));

    useEffect(() => {
        const nextSnapshot = cardEditSnapshotFromCard(card);
        setTitle(nextSnapshot.title);
        setColumnId(nextSnapshot.columnId);
        setPriority(nextSnapshot.priority);
        setStartDate(nextSnapshot.startDate);
        setEndDate(nextSnapshot.endDate);
        setDescriptionMarkdown(nextSnapshot.descriptionMarkdown);
        setDescriptionJson(nextSnapshot.descriptionJson);
        setDescriptionText(nextSnapshot.descriptionText);
        setSubtasks(nextSnapshot.subtasks);
        setComments(nextSnapshot.comments);
        lastSavedSnapshot.current = cardEditSnapshotKey(nextSnapshot);
    }, [card.id]);

    useEffect(() => {
        const snapshot: CardEditSnapshot = { title, columnId, priority, startDate, endDate, descriptionMarkdown, descriptionJson, descriptionText, subtasks, comments };
        const snapshotKey = cardEditSnapshotKey(snapshot);
        if (snapshotKey === lastSavedSnapshot.current) return;
        const timeout = window.setTimeout(() => {
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
        setTitle,
        setColumnId,
        setPriority,
        setStartDate,
        setEndDate,
        setDescriptionMarkdown,
        setDescriptionJson,
        setDescriptionText,
        setSubtasks,
        setComments,
        addSubtask,
        updateSubtask,
        deleteSubtask,
        reorderSubtask,
        addComment,
        deleteComment
    };
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
