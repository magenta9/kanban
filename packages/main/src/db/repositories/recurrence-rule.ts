import type { KanbanRecurrenceCycle } from "@kanban/shared";

export const fixedRecurrenceCatchUpLimit = 7;
const fixedRecurrenceHour = 8;

export interface FixedRecurrenceDueCalculation {
    occurrenceDates: number[];
    skippedThroughDate?: number;
}

export function calculateFixedRecurrenceDueDates(input: {
    lastOccurrenceDate: number;
    cycle: KanbanRecurrenceCycle;
    anchorDay: number;
    now: number;
    catchUpLimit?: number;
}): FixedRecurrenceDueCalculation {
    const dueDate = fixedRecurrenceDueDate(input.now);
    const dueDates: number[] = [];
    let nextDate = nextRecurrenceDate(input.lastOccurrenceDate, input.cycle, input.anchorDay);

    while (nextDate <= dueDate) {
        dueDates.push(nextDate);
        nextDate = nextRecurrenceDate(nextDate, input.cycle, input.anchorDay);
    }

    const catchUpLimit = input.catchUpLimit ?? fixedRecurrenceCatchUpLimit;
    return {
        occurrenceDates: dueDates.slice(-catchUpLimit),
        skippedThroughDate: dueDates.length > catchUpLimit ? dueDates[dueDates.length - 1] : undefined
    };
}

export function dateOnlyTimestampFromTimestamp(timestamp: number): number {
    const date = new Date(timestamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function fixedRecurrenceDueDate(now: number): number {
    const date = new Date(now);
    const todayAtFixedHour = new Date(date.getFullYear(), date.getMonth(), date.getDate(), fixedRecurrenceHour).getTime();
    const due = now >= todayAtFixedHour ? date : new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    return new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
}

export function nextRecurrenceDate(timestamp: number, cycle: KanbanRecurrenceCycle, anchorDay?: number): number {
    const date = new Date(timestamp);
    if (cycle === "daily") return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    if (cycle === "weekly") return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime();
    const targetYear = date.getFullYear();
    const targetMonth = date.getMonth() + 1;
    const targetDay = Math.min(anchorDay ?? date.getDate(), new Date(targetYear, targetMonth + 1, 0).getDate());
    return new Date(targetYear, targetMonth, targetDay).getTime();
}