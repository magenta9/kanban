import { describe, expect, it } from "vitest";
import { calculateFixedRecurrenceDueDates, fixedRecurrenceDueDate, nextRecurrenceDate } from "./recurrence-rule";

describe("Recurrence Rule", () => {
    it("calculates fixed daily and weekly due occurrence dates", () => {
        expect(calculateFixedRecurrenceDueDates({
            lastOccurrenceDate: date(2026, 0, 1),
            cycle: "daily",
            anchorDay: 1,
            now: new Date(2026, 0, 4, 9).getTime()
        }).occurrenceDates).toEqual([date(2026, 0, 2), date(2026, 0, 3), date(2026, 0, 4)]);

        expect(calculateFixedRecurrenceDueDates({
            lastOccurrenceDate: date(2026, 0, 1),
            cycle: "weekly",
            anchorDay: 1,
            now: new Date(2026, 0, 15, 9).getTime()
        }).occurrenceDates).toEqual([date(2026, 0, 8), date(2026, 0, 15)]);
    });

    it("keeps monthly recurrence anchored to the original day", () => {
        const februaryDate = nextRecurrenceDate(date(2026, 0, 31), "monthly", 31);
        const marchDate = nextRecurrenceDate(februaryDate, "monthly", 31);

        expect(februaryDate).toBe(date(2026, 1, 28));
        expect(marchDate).toBe(date(2026, 2, 31));
    });

    it("returns only the latest missed fixed occurrences beyond the catch-up limit", () => {
        const result = calculateFixedRecurrenceDueDates({
            lastOccurrenceDate: date(2026, 0, 1),
            cycle: "daily",
            anchorDay: 1,
            now: new Date(2026, 0, 12, 9).getTime()
        });

        expect(result.occurrenceDates).toEqual([
            date(2026, 0, 6),
            date(2026, 0, 7),
            date(2026, 0, 8),
            date(2026, 0, 9),
            date(2026, 0, 10),
            date(2026, 0, 11),
            date(2026, 0, 12)
        ]);
        expect(result.skippedThroughDate).toBe(date(2026, 0, 12));
    });

    it("uses the fixed recurrence hour as the daily due threshold", () => {
        expect(fixedRecurrenceDueDate(new Date(2026, 0, 12, 7).getTime())).toBe(date(2026, 0, 11));
        expect(fixedRecurrenceDueDate(new Date(2026, 0, 12, 8).getTime())).toBe(date(2026, 0, 12));
    });
});

function date(year: number, month: number, day: number): number {
    return new Date(year, month, day).getTime();
}