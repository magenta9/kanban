import type { Editor, JSONContent } from "@tiptap/react";
import type { AiLabelSuggestion, AiTextSuggestionField, KanbanCard, KanbanLabel, KanbanRecurrenceCycle } from "@kanban/shared";

export type KeyboardShortcutAction =
    | { type: "openHelp" }
    | { type: "close" }
    | { type: "toggleBoardList" }
    | { type: "createCard" }
    | { type: "createColumn" }
    | { type: "setView"; view: "kanban" | "list" | "archive" }
    | { type: "selectBoardByIndex"; index: number };

const labelColors = ["#756858", "#6f7a43", "#b36a3c", "#8f6f4f", "#9a5f54"] as const;
const richTextLinkPlaceholder = "link";
const richTextBareHttpUrlPattern = /^https?:\/\/\S+$/i;

export function relatedCardsForAiContext(card: KanbanCard, cards: KanbanCard[]): KanbanCard[] {
    const activeCards = cards.filter((item) => !item.archivedAt && item.id !== card.id);
    const related = card.labelIds.length > 0
        ? activeCards.filter((item) => item.labelIds.some((labelId) => card.labelIds.includes(labelId)))
        : activeCards;
    return related.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 20);
}

export function draftCardsForAiContext(columnId: string, cards: KanbanCard[]): KanbanCard[] {
    return cards.filter((card) => !card.archivedAt && card.columnId === columnId).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 20);
}

export function shouldRequestInlineCompletion(textBeforeCursor: string, textAfterCursor: string, minChars: number, focused: boolean): boolean {
    return focused && textAfterCursor.length === 0 && textBeforeCursor.trim().length >= minChars;
}

export function shouldApplyInlineCompletion(requestedCursor: { before: string; after: string }, liveCursor: { before: string; after: string }, minChars: number, focused: boolean): boolean {
    return requestedCursor.before === liveCursor.before
        && requestedCursor.after === liveCursor.after
        && shouldRequestInlineCompletion(liveCursor.before, liveCursor.after, minChars, focused);
}

export function isInlineCompletionAcceptShortcut(key: string, field: AiTextSuggestionField): boolean {
    return key === "Tab";
}

export function shouldSyncRichTextEditorContent(currentValue: JSONContent, nextValue: JSONContent): boolean {
    return JSON.stringify(currentValue) !== JSON.stringify(nextValue);
}

export function parseRichTextMarkdownLink(text: string): { label: string; url: string } | null {
    const match = /^\[(?<label>[^\]\n]+)\]\((?<url>https?:\/\/[^\s)]+)\)$/i.exec(text.trim());
    if (!match?.groups) return null;
    const { label, url } = match.groups;
    if (!label || !url) return null;
    return {
        label,
        url
    };
}

export function findRichTextMarkdownLinkSuffix(text: string): { label: string; url: string; start: number; end: number } | null {
    const match = /\[(?<label>[^\]\n]+)\]\((?<url>https?:\/\/[^\s)]+)\)$/i.exec(text);
    if (!match?.groups) return null;
    const { label, url } = match.groups;
    if (!label || !url) return null;
    return {
        label,
        url,
        start: match.index,
        end: match.index + match[0].length
    };
}

export function resolveRichTextLinkPaste(text: string): { label: string; url: string; selectLabel: boolean } | null {
    const normalizedText = text.trim();
    const markdownLink = parseRichTextMarkdownLink(normalizedText);
    if (markdownLink) {
        return {
            ...markdownLink,
            selectLabel: false
        };
    }
    if (!richTextBareHttpUrlPattern.test(normalizedText)) return null;
    return {
        label: richTextLinkPlaceholder,
        url: normalizedText,
        selectLabel: true
    };
}

export function isRichTextSubmitShortcut(event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing">): boolean {
    return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function isRichTextListContinuationShortcut(event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing">): boolean {
    return event.key === "Enter" && event.shiftKey && !event.isComposing;
}

export function isRichTextListIndentShortcut(event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing">): boolean {
    return event.key === "Tab" && !event.isComposing;
}

export function isRichTextListActive(editor: Pick<Editor, "isActive">): boolean {
    return editor.isActive("orderedList") || editor.isActive("bulletList");
}

export function applyRichTextListContinuation(editor: Pick<Editor, "isActive"> & { commands: Pick<Editor["commands"], "splitListItem" | "liftListItem"> }): boolean {
    return editor.commands.splitListItem("listItem") || editor.commands.liftListItem("listItem");
}

export function applyRichTextListIndentation(editor: Pick<Editor, "isActive"> & { commands: Pick<Editor["commands"], "sinkListItem" | "liftListItem"> }, outdent: boolean): boolean {
    if (!isRichTextListActive(editor)) return false;
    return outdent ? editor.commands.liftListItem("listItem") : editor.commands.sinkListItem("listItem");
}

export function isMarkdownSubmitShortcut(event: Pick<KeyboardEvent, "key" | "shiftKey"> & { isComposing?: boolean }): boolean {
    return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    let element: Element | null = target;
    while (element) {
        if (element.matches("input, textarea, select")) return true;
        if (element instanceof HTMLElement && (element.isContentEditable || element.contentEditable === "true" || element.getAttribute("contenteditable") === "")) return true;
        element = element.parentElement;
    }
    return false;
}

export function keyboardShortcutFromEvent(event: Pick<KeyboardEvent, "key" | "metaKey" | "shiftKey" | "altKey">, editableTarget: boolean): KeyboardShortcutAction | null {
    if (event.key === "Escape") return { type: "close" };
    if (event.metaKey && !event.shiftKey && !event.altKey && event.key === "/") return { type: "openHelp" };
    if (editableTarget || !event.metaKey || event.altKey) return null;

    if (!event.shiftKey && /^[1-9]$/.test(event.key)) {
        return { type: "selectBoardByIndex", index: Number(event.key) - 1 };
    }

    const key = event.key.toLowerCase();
    if (!event.shiftKey && key === "b") return { type: "toggleBoardList" };
    if (!event.shiftKey && key === "k") return { type: "setView", view: "kanban" };
    if (!event.shiftKey && key === "l") return { type: "setView", view: "list" };
    if (!event.shiftKey && key === "a") return { type: "setView", view: "archive" };
    if (!event.shiftKey && key === "n") return { type: "createCard" };
    if (event.shiftKey && key === "n") return { type: "createColumn" };
    return null;
}

export function recurrenceSummary(card: KanbanCard): string {
    if (!card.recurrence) return "未开启周期";
    const cycle = recurrenceCycleLabel(card.recurrence.cycle);
    const trigger = card.recurrence.trigger === "fixed" ? "固定时间" : "完成后";
    return card.recurrence.status === "blocked" ? `已阻塞：${card.recurrence.blockedReason ?? "需要处理"}` : `${cycle} · ${trigger}`;
}

function recurrenceCycleLabel(cycle: KanbanRecurrenceCycle): string {
    if (cycle === "daily") return "每日";
    if (cycle === "weekly") return "每周";
    return "每月";
}

export function stableLabelColor(boardId: string, name: string): string {
    const normalized = `${boardId}:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;
    let hash = 0;
    for (let index = 0; index < normalized.length; index += 1) {
        hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
    }
    return labelColors[hash % labelColors.length] ?? "#756858";
}

export function buildLabelPrefixIndex(labels: KanbanLabel[]): Map<string, KanbanLabel[]> {
    const index = new Map<string, KanbanLabel[]>();
    const sortedLabels = [...labels].sort((left, right) => labelSearchKey(left.name).localeCompare(labelSearchKey(right.name)));
    for (const label of sortedLabels) {
        const key = labelSearchKey(label.name);
        for (let prefixLength = 0; prefixLength <= key.length; prefixLength += 1) {
            const prefix = key.slice(0, prefixLength);
            const matches = index.get(prefix) ?? [];
            matches.push(label);
            index.set(prefix, matches);
        }
    }
    return index;
}

export function suggestBoardLabelsByPrefix(labels: KanbanLabel[], attachedLabelIds: string[], draft: string, maxSuggestions: number): AiLabelSuggestion[] {
    const prefixIndex = buildLabelPrefixIndex(labels);
    const attached = new Set(attachedLabelIds);
    const prefix = labelSearchKey(draft);
    const seen = new Set<string>();
    return (prefixIndex.get(prefix) ?? [])
        .filter((label) => !attached.has(label.id))
        .filter((label) => {
            const key = labelSearchKey(label.name);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, maxSuggestions)
        .map((label) => ({ name: label.name, existingLabelId: label.id }));
}

function labelSearchKey(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeDateRange(startDate: number, endDate: number): { startDate: number; endDate: number } {
    return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

function formatDisplayDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDisplayDateWithYear(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateRange(startDate?: number, endDate?: number): string {
    if (startDate === undefined && endDate === undefined) return "No date";
    const start = startDate ?? endDate;
    const end = endDate ?? startDate;
    if (start === undefined || end === undefined) return "No date";
    if (start === end) return formatDisplayDate(start);

    const startYear = new Date(start).getFullYear();
    const endYear = new Date(end).getFullYear();
    const currentYear = new Date().getFullYear();
    if (startYear !== endYear) return `${formatDisplayDateWithYear(start)} - ${formatDisplayDateWithYear(end)}`;
    if (endYear !== currentYear) return `${formatDisplayDate(start)} - ${formatDisplayDateWithYear(end)}`;
    return `${formatDisplayDate(start)} - ${formatDisplayDate(end)}`;
}