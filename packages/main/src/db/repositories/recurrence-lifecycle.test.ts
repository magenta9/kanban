import { describe, expect, it, vi } from "vitest";
import {
    RecurrenceLifecycle,
    unavailableCompletionColumnReason,
    type CompletionColumnGenerationContext,
    type RecurrenceLifecycleAdapter
} from "./recurrence-lifecycle";

function createLifecycle() {
    const adapter = {
        updateTemplateForActiveBaton: vi.fn(),
        readCompletionColumnGenerationContext: vi.fn(),
        generateNextOccurrence: vi.fn(),
        blockSeries: vi.fn(),
        stopSeriesForActiveBaton: vi.fn()
    } satisfies RecurrenceLifecycleAdapter;
    return { lifecycle: new RecurrenceLifecycle(adapter), adapter };
}

function completionContext(input: Partial<CompletionColumnGenerationContext> = {}): CompletionColumnGenerationContext {
    return {
        seriesId: "series-1",
        cardColumnId: "done",
        completionColumnId: "done",
        completionColumnActive: true,
        nextOccurrenceDate: 456,
        ...input
    };
}

describe("RecurrenceLifecycle", () => {
    it("updates the Series Template and checks completion generation after Card updates", () => {
        const { lifecycle, adapter } = createLifecycle();

        lifecycle.afterCardUpdated("card-1", 123);

        expect(adapter.updateTemplateForActiveBaton).toHaveBeenCalledWith("card-1");
        expect(adapter.readCompletionColumnGenerationContext).toHaveBeenCalledWith("card-1", 123);
        expect(adapter.generateNextOccurrence).not.toHaveBeenCalled();
        expect(adapter.blockSeries).not.toHaveBeenCalled();
        expect(adapter.stopSeriesForActiveBaton).not.toHaveBeenCalled();
    });

    it("checks completion generation after Card moves", () => {
        const { lifecycle, adapter } = createLifecycle();

        lifecycle.afterCardMoved("card-1", 123);

        expect(adapter.readCompletionColumnGenerationContext).toHaveBeenCalledWith("card-1", 123);
        expect(adapter.updateTemplateForActiveBaton).not.toHaveBeenCalled();
        expect(adapter.generateNextOccurrence).not.toHaveBeenCalled();
        expect(adapter.stopSeriesForActiveBaton).not.toHaveBeenCalled();
    });

    it("generates the next Occurrence when a Recurring Card reaches the Completion Column", () => {
        const { lifecycle, adapter } = createLifecycle();
        adapter.readCompletionColumnGenerationContext.mockReturnValue(completionContext());

        lifecycle.afterCardMoved("card-1", 123);

        expect(adapter.generateNextOccurrence).toHaveBeenCalledWith("series-1", 456, 123);
        expect(adapter.blockSeries).not.toHaveBeenCalled();
    });

    it("does not generate the next Occurrence more than once", () => {
        const { lifecycle, adapter } = createLifecycle();
        adapter.readCompletionColumnGenerationContext.mockReturnValue(completionContext({ generatedNextAt: 789 }));

        lifecycle.afterCardMoved("card-1", 123);

        expect(adapter.generateNextOccurrence).not.toHaveBeenCalled();
        expect(adapter.blockSeries).not.toHaveBeenCalled();
    });

    it("blocks the Recurrence Series when the Completion Column is missing or archived", () => {
        const { lifecycle, adapter } = createLifecycle();
        adapter.readCompletionColumnGenerationContext
            .mockReturnValueOnce(completionContext({ completionColumnId: undefined, completionColumnActive: false }))
            .mockReturnValueOnce(completionContext({ completionColumnId: "done", completionColumnActive: false }));

        lifecycle.afterCardMoved("card-1", 123);
        lifecycle.afterCardMoved("card-1", 456);

        expect(adapter.blockSeries).toHaveBeenNthCalledWith(1, "series-1", unavailableCompletionColumnReason, 123);
        expect(adapter.blockSeries).toHaveBeenNthCalledWith(2, "series-1", unavailableCompletionColumnReason, 456);
        expect(adapter.generateNextOccurrence).not.toHaveBeenCalled();
    });

    it("stops the Recurrence Series when the active Baton Card is deleted or archived", () => {
        const { lifecycle, adapter } = createLifecycle();

        lifecycle.afterCardDeleted("card-1");
        lifecycle.afterCardArchived("card-2", 456);
        lifecycle.disableCardRecurrence("card-3");

        expect(adapter.stopSeriesForActiveBaton).toHaveBeenNthCalledWith(1, "card-1");
        expect(adapter.stopSeriesForActiveBaton).toHaveBeenNthCalledWith(2, "card-2", 456);
        expect(adapter.stopSeriesForActiveBaton).toHaveBeenNthCalledWith(3, "card-3");
    });

    it("updates the Series Template after Label changes", () => {
        const { lifecycle, adapter } = createLifecycle();

        lifecycle.afterCardLabelsChanged("card-1");

        expect(adapter.updateTemplateForActiveBaton).toHaveBeenCalledWith("card-1");
        expect(adapter.readCompletionColumnGenerationContext).not.toHaveBeenCalled();
        expect(adapter.generateNextOccurrence).not.toHaveBeenCalled();
    });
});
