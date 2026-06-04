import type { AiLabelSuggestion, AiLabelSuggestionInput, AiLabelSuggestionResult, AiLogPrompt, AiTextSuggestionInput, AiTextSuggestionResult } from "@kanban/shared";
import { buildLabelMessages, buildTextPromptInput, buildTextSystemPrompt, labelSuggestionOutputSchema, normalizeLabelName as normalizeContractLabelName, textMaxTokens, textSuggestionOutputSchema } from "./suggestion-contract";
import { chatCompletionHeaders, ollamaChatBody, ollamaChatUrl, responseErrorDetail, type AiSettingsService } from "./settings-service";
import {
    normalizeInsertionSuggestion,
    normalizeSuggestion,
    normalizeTextSuggestion,
    promptEmptyDecisionReason,
    requestedEmptyCompletionReason,
    resolveTextSuggestion,
    textSuggestionDecision,
    textSuggestionDiscardMessage,
    textSuggestionScenario
} from "./text-suggestion-decision";

export { normalizeInsertionSuggestion, normalizeSuggestion, normalizeTextSuggestion, resolveTextSuggestion } from "./text-suggestion-decision";

interface OllamaChatResponse {
    message?: { content?: string };
}

interface CompletionResult {
    content: string;
    statusCode: number;
}

class CompletionError extends Error {
    constructor(message: string, readonly statusCode?: number) {
        super(message);
        this.name = "CompletionError";
    }
}

const completionTimeoutMs = 30_000;

export class AiSuggestionService {
    constructor(private readonly settings: AiSettingsService) { }

    async suggestText(input: AiTextSuggestionInput): Promise<AiTextSuggestionResult> {
        const state = this.settings.getSettings();
        const scope = `suggestText:${input.field}`;
        const scenario = textSuggestionScenario(input.field);
        if (!state.enabled || !state.configured) {
            const decision = textSuggestionDecision("skipped", "settings_unavailable");
            this.settings.recordEvent({ level: "warn", scope, scenario, event: "skipped", decision, message: "AI text suggestion skipped: settings are disabled or incomplete." });
            return {};
        }

        const startedAt = Date.now();
        const promptInput = buildTextPromptInput(input);
        const messages = [
            { role: "system", content: buildTextSystemPrompt(input.field) },
            { role: "user", content: JSON.stringify(promptInput) }
        ];
        const prompt = logPrompt(messages);
        const promptChars = promptCharCount(messages);
        const emptyReason = requestedEmptyCompletionReason(promptInput);
        if (emptyReason) {
            const decision = textSuggestionDecision("skipped", promptEmptyDecisionReason(input.field, emptyReason), emptyReason);
            this.settings.recordEvent({ level: "info", scope, scenario, event: "skipped", prompt, decision, message: `AI text suggestion skipped: ${emptyReason}.`, durationMs: Date.now() - startedAt, promptChars });
            return {};
        }
        try {
            const result = await this.complete({
                baseUrl: state.baseUrl,
                model: state.model,
                messages,
                maxTokens: textMaxTokens(input),
                format: textSuggestionOutputSchema
            });
            const durationMs = Date.now() - startedAt;
            const content = result.content;
            const { normalized, suggestion, decision } = resolveTextSuggestion(content, input);
            if (suggestion) {
                this.settings.recordEvent({
                    level: "info",
                    scope,
                    scenario,
                    event: "success",
                    decision,
                    message: `AI text suggestion completed: ${[...suggestion].length} characters.`,
                    statusCode: result.statusCode,
                    durationMs,
                    promptChars,
                    outputChars: textCharCount(content)
                });
                return { suggestion };
            }
            this.settings.recordEvent({ level: "warn", scope, scenario, event: "discarded", prompt, decision, message: textSuggestionDiscardMessage(content, normalized, suggestion), statusCode: result.statusCode, durationMs, promptChars, outputChars: textCharCount(content) });
        }
        catch (caught) {
            const message = errorMessage(caught);
            const decision = textSuggestionDecision("failed", "provider_error", message);
            this.settings.recordError({ scope, scenario, event: "error", prompt, decision, message, ...errorStatusCode(caught), durationMs: Date.now() - startedAt, promptChars });
            return {};
        }
        return {};
    }

    async suggestLabels(input: AiLabelSuggestionInput): Promise<AiLabelSuggestionResult> {
        const state = this.settings.getSettings();
        const scope = "suggestLabels:tags";
        const scenario = "tag-autocomplete";
        if (!state.enabled || !state.configured) {
            this.settings.recordEvent({ level: "warn", scope, scenario, event: "skipped", message: "AI tag autocomplete skipped: settings are disabled or incomplete." });
            return { suggestions: [] };
        }

        const startedAt = Date.now();
        const messages = buildLabelMessages(input);
        const prompt = logPrompt(messages);
        const promptChars = promptCharCount(messages);
        try {
            const result = await this.complete({
                baseUrl: state.baseUrl,
                model: state.model,
                messages,
                maxTokens: 128,
                format: labelSuggestionOutputSchema
            });
            const durationMs = Date.now() - startedAt;
            const suggestions = normalizeLabelSuggestions(result.content, input.maxSuggestions, input.context.boardLabels, input.context.currentCard.labelIds)
                .filter((suggestion) => normalizeLabelName(suggestion.name) !== normalizeLabelName(input.context.currentCard.title));
            this.settings.recordEvent({
                level: suggestions.length > 0 ? "info" : "warn",
                scope,
                scenario,
                event: suggestions.length > 0 ? "success" : "empty",
                message: `AI tag autocomplete completed: ${suggestions.length} usable suggestions.`,
                statusCode: result.statusCode,
                durationMs,
                promptChars,
                outputChars: textCharCount(result.content)
            });
            return { suggestions };
        }
        catch (caught) {
            this.settings.recordError({ scope, scenario, event: "error", prompt, message: errorMessage(caught), ...errorStatusCode(caught), durationMs: Date.now() - startedAt, promptChars });
            return { suggestions: [] };
        }
    }

    private async complete(input: { baseUrl: string; model: string; messages: Array<{ role: string; content: string }>; maxTokens: number; format?: object }): Promise<CompletionResult> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), completionTimeoutMs);
        try {
            const response = await fetch(ollamaChatUrl(input.baseUrl), {
                method: "POST",
                signal: controller.signal,
                headers: chatCompletionHeaders(),
                body: JSON.stringify(ollamaChatBody({ model: input.model, messages: input.messages, maxTokens: input.maxTokens, format: input.format }))
            });
            if (!response.ok) {
                const detail = await responseErrorDetail(response);
                throw new CompletionError(`HTTP ${response.status}${detail ? ` ${detail}` : ""}`, response.status);
            }
            const json = await response.json() as OllamaChatResponse;
            const content = json.message?.content;
            return { content: content ?? "", statusCode: response.status };
        }
        finally {
            clearTimeout(timeout);
        }
    }
}

export function normalizeLabelSuggestions(raw: string, maxSuggestions: number, boardLabels: Array<{ id: string; name: string }>, attachedLabelIds: string[]): AiLabelSuggestion[] {
    const parsed = parseLabelNames(raw);
    const attached = new Set(attachedLabelIds);
    const byName = new Map(boardLabels.map((label) => [normalizeLabelName(label.name), label]));
    const seen = new Set<string>();
    const suggestions: AiLabelSuggestion[] = [];
    for (const name of parsed) {
        const normalized = normalizeLabelName(name);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        const existing = byName.get(normalized);
        if (existing && attached.has(existing.id)) continue;
        suggestions.push({ name: name.trim(), ...(existing ? { existingLabelId: existing.id } : {}) });
    }
    return suggestions
        .map((suggestion, index) => ({ suggestion, index }))
        .sort((left, right) => Number(Boolean(right.suggestion.existingLabelId)) - Number(Boolean(left.suggestion.existingLabelId)) || left.index - right.index)
        .slice(0, maxSuggestions)
        .map((item) => item.suggestion);
}

export function normalizeLabelName(value: string): string {
    return normalizeContractLabelName(value);
}

function parseLabelNames(raw: string): string[] {
    const trimmed = jsonCandidate(stripFencedText(stripModelReasoning(raw)));
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return labelNamesFromUnknownArray(parsed);
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as { labels?: unknown[] }).labels)) {
            return labelNamesFromUnknownArray((parsed as { labels: unknown[] }).labels);
        }
        if (parsed && typeof parsed === "object" && Array.isArray((parsed as { suggestions?: unknown[] }).suggestions)) {
            return labelNamesFromUnknownArray((parsed as { suggestions: unknown[] }).suggestions);
        }
    }
    catch { }
    return [];
}

function labelNamesFromUnknownArray(values: unknown[]): string[] {
    return values.flatMap((item) => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") return [(item as { name: string }).name];
        return [];
    });
}

function logPrompt(messages: Array<{ role: string; content: string }>): AiLogPrompt {
    return { messages };
}

function promptCharCount(messages: Array<{ role: string; content: string }>): number {
    return textCharCount(JSON.stringify({ messages }));
}

function textCharCount(value: string): number {
    return [...value].length;
}

function stripModelReasoning(value: string): string {
    const withoutClosedBlocks = value.replace(/<think>[\s\S]*?<\/think>/gi, "");
    const openBlockIndex = withoutClosedBlocks.search(/<think>/i);
    return openBlockIndex >= 0 ? withoutClosedBlocks.slice(0, openBlockIndex) : withoutClosedBlocks;
}

function stripFencedText(value: string): string {
    const trimmed = value.trim();
    const match = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
    return match?.[1]?.trim() ?? trimmed;
}

function jsonCandidate(value: string): string {
    const trimmed = value.trim();
    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1);

    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1);

    return trimmed;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
    try {
        const parsed = JSON.parse(jsonCandidate(value)) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    }
    catch { }
    return undefined;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && (error.name === "AbortError" || error.message === "This operation was aborted")) return "AI suggestion timed out.";
    return error instanceof Error ? error.message : String(error);
}

function errorStatusCode(error: unknown): { statusCode?: number } {
    return error instanceof CompletionError && error.statusCode !== undefined ? { statusCode: error.statusCode } : {};
}
