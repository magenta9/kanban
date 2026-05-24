export const unavailableCompletionColumnReason = "请选择一个可用的完成列。";

export interface CompletionColumnGenerationContext {
    seriesId: string;
    cardColumnId: string;
    completionColumnId?: string;
    completionColumnActive: boolean;
    generatedNextAt?: number;
    nextOccurrenceDate: number;
}

export interface RecurrenceLifecycleAdapter {
    updateTemplateForActiveBaton(cardId: string): void;
    readCompletionColumnGenerationContext(cardId: string, now: number): CompletionColumnGenerationContext | undefined;
    generateNextOccurrence(seriesId: string, occurrenceDate: number, now: number): void;
    blockSeries(seriesId: string, reason: string, now: number): void;
    stopSeriesForActiveBaton(cardId: string, now?: number): void;
}

export class RecurrenceLifecycle {
    constructor(private readonly adapter: RecurrenceLifecycleAdapter) { }

    afterCardUpdated(cardId: string, now: number): void {
        this.adapter.updateTemplateForActiveBaton(cardId);
        this.generateNextForCompletedCard(cardId, now);
    }

    afterCardMoved(cardId: string, now: number): void {
        this.generateNextForCompletedCard(cardId, now);
    }

    afterCardDeleted(cardId: string): void {
        this.adapter.stopSeriesForActiveBaton(cardId);
    }

    afterCardArchived(cardId: string, now: number): void {
        this.adapter.stopSeriesForActiveBaton(cardId, now);
    }

    afterCardLabelsChanged(cardId: string): void {
        this.adapter.updateTemplateForActiveBaton(cardId);
    }

    disableCardRecurrence(cardId: string): void {
        this.adapter.stopSeriesForActiveBaton(cardId);
    }

    private generateNextForCompletedCard(cardId: string, now: number): void {
        const context = this.adapter.readCompletionColumnGenerationContext(cardId, now);
        if (!context || context.generatedNextAt) return;

        if (!context.completionColumnId || !context.completionColumnActive) {
            this.adapter.blockSeries(context.seriesId, unavailableCompletionColumnReason, now);
            return;
        }

        if (context.cardColumnId !== context.completionColumnId) return;
        this.adapter.generateNextOccurrence(context.seriesId, context.nextOccurrenceDate, now);
    }
}
