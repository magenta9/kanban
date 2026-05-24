import { useRef, useState } from "react";
import type { KanbanCard, KanbanColumn } from "@kanban/shared";

export interface DraftCard {
    columnId: string;
    title: string;
}

export function chooseDraftCardColumnId({
    selectedCard,
    visibleColumns,
    activeDraftColumnId
}: {
    selectedCard?: KanbanCard;
    visibleColumns: KanbanColumn[];
    activeDraftColumnId?: string;
}): string {
    const selectedCardColumnId = selectedCard && visibleColumns.some((column) => column.id === selectedCard.columnId) ? selectedCard.columnId : "";
    const activeDraftColumnIdIsVisible = activeDraftColumnId && visibleColumns.some((column) => column.id === activeDraftColumnId);
    return selectedCardColumnId || (activeDraftColumnIdIsVisible ? activeDraftColumnId : "") || (visibleColumns[0]?.id ?? "");
}

export function useDraftCardState(): {
    draftCard: DraftCard | null;
    activeColumnId: string;
    titleForColumn: (columnId: string) => string;
    isComposerOpen: (columnId: string) => boolean;
    setTitle: (columnId: string, title: string) => void;
    setInputRef: (columnId: string, node: HTMLInputElement | null) => void;
    open: (columnId: string, options?: { focus?: boolean }) => void;
    openFromShortcut: (input: { selectedCard?: KanbanCard; visibleColumns: KanbanColumn[] }) => string;
    close: () => void;
    submit: (columnId: string, create: (title: string) => Promise<void>) => Promise<boolean>;
} {
    const [draftCard, setDraftCard] = useState<DraftCard | null>(null);
    const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    function focus(columnId: string): void {
        window.requestAnimationFrame(() => inputRefs.current[columnId]?.focus());
    }

    function open(columnId: string, options: { focus?: boolean } = {}): void {
        setDraftCard((current) => current?.columnId === columnId ? current : { columnId, title: "" });
        if (options.focus) focus(columnId);
    }

    function close(): void {
        setDraftCard(null);
    }

    function setTitle(columnId: string, title: string): void {
        setDraftCard((current) => current?.columnId === columnId ? { ...current, title } : { columnId, title });
    }

    async function submit(columnId: string, create: (title: string) => Promise<void>): Promise<boolean> {
        if (draftCard?.columnId !== columnId) return false;
        const title = draftCard.title.trim();
        if (!title) return false;
        await create(title);
        close();
        return true;
    }

    function openFromShortcut(input: { selectedCard?: KanbanCard; visibleColumns: KanbanColumn[] }): string {
        const columnId = chooseDraftCardColumnId({ ...input, activeDraftColumnId: draftCard?.columnId });
        if (!columnId) return "";
        open(columnId, { focus: true });
        return columnId;
    }

    return {
        draftCard,
        activeColumnId: draftCard?.columnId ?? "",
        titleForColumn: (columnId) => draftCard?.columnId === columnId ? draftCard.title : "",
        isComposerOpen: (columnId) => draftCard?.columnId === columnId,
        setTitle,
        setInputRef: (columnId, node) => { inputRefs.current[columnId] = node; },
        open,
        openFromShortcut,
        close,
        submit
    };
}
