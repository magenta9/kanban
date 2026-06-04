import type { AiSuggestionCardContext, KanbanCard } from "@kanban/shared";

export function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeLabelName(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function dominantLabelScript(values: string[]): "ascii" | "mixed" {
    const names = uniqueStrings(values);
    if (names.length < 3) return "mixed";
    const asciiCount = names.filter(isAsciiText).length;
    return asciiCount / names.length >= 0.7 ? "ascii" : "mixed";
}

export function isAsciiText(value: string): boolean {
    return /^[\x00-\x7F]+$/.test(value.trim());
}

export function headText(value: string, maxChars: number): string {
    return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

export function tailText(value: string, maxChars: number): string {
    return value.length > maxChars ? `...${value.slice(value.length - maxChars)}` : value;
}

export function compactBoard(context: AiSuggestionCardContext): object {
    return {
        columnName: context.columnName,
        labels: uniqueStrings(context.boardLabels.map((label) => label.name)).slice(0, 50)
    };
}

export function compactCard(card: KanbanCard, context: AiSuggestionCardContext): object {
    const labelsById = new Map(context.boardLabels.map((label) => [label.id, label.name]));
    return {
        title: card.title,
        descriptionText: headText(card.descriptionText ?? card.descriptionMarkdown ?? "", 600),
        priority: card.priority,
        dates: compactCardDates(card),
        recurrence: card.recurrence ? {
            trigger: card.recurrence.trigger,
            cycle: card.recurrence.cycle,
            status: card.recurrence.status,
            blockedReason: card.recurrence.blockedReason
        } : undefined,
        labels: card.labelIds.map((id) => labelsById.get(id)).filter((name): name is string => Boolean(name)),
        subtasks: card.subtasks.slice(0, 8).map((subtask) => ({ title: subtask.title, completed: subtask.completed })).filter((subtask) => Boolean(subtask.title)),
        comments: card.comments.slice(-3).map((comment) => headText(comment.body, 240)).filter(Boolean)
    };
}

function compactCardDates(card: KanbanCard): object | undefined {
    const dates = {
        startDate: compactDate(card.startDate),
        dueDate: compactDate(card.dueDate),
        endDate: compactDate(card.endDate)
    };
    return dates.startDate || dates.dueDate || dates.endDate ? dates : undefined;
}

function compactDate(value: number | undefined): string | undefined {
    return typeof value === "number" ? new Date(value).toISOString().slice(0, 10) : undefined;
}
