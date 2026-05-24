import type { AiLabelSuggestion, AiLabelSuggestionInput, AiLabelSuggestionResult, AiLogPrompt, AiTextSuggestionField, AiTextSuggestionInput, AiTextSuggestionResult } from "@kanban/shared";
import { blockedDescriptionInsertions, buildLabelMessages, buildTextPromptInput, buildTextSystemPrompt, labelSuggestionOutputSchema, localCursorLine, normalizeLabelName as normalizeContractLabelName, previousListItems, textMaxTokens, textSuggestionOutputSchema } from "./suggestion-contract";
import { chatCompletionHeaders, ollamaChatBody, ollamaChatUrl, responseErrorDetail, type AiSettingsService } from "./settings-service";

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
            this.settings.recordEvent({ level: "warn", scope, scenario, event: "skipped", message: "AI text suggestion skipped: settings are disabled or incomplete." });
            return {};
        }

        const startedAt = Date.now();
        const promptInput = buildTextPromptInput(input);
        const messages = [
            { role: "system", content: buildTextSystemPrompt(input.field) },
            { role: "user", content: JSON.stringify(promptInput) }
        ];
        const prompt = logPrompt(messages);
        const emptyReason = requestedEmptyCompletionReason(promptInput);
        if (emptyReason) {
            this.settings.recordEvent({ level: "info", scope, scenario, event: "skipped", prompt, message: `AI text suggestion skipped: ${emptyReason}.`, durationMs: Date.now() - startedAt });
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
            const resolved = resolveTextSuggestion(content, promptInput, input);
            const { normalized, suggestion, finalSuggestion, usedFallback, usedShortened } = resolved;
            if (finalSuggestion) {
                this.settings.recordEvent({
                    level: "info",
                    scope,
                    scenario,
                    event: "success",
                    prompt,
                    message: `AI text suggestion completed: ${[...finalSuggestion].length} characters${usedFallback ? " (grounded hint fallback)" : usedShortened ? " (shortened to fit limit)" : ""}.`,
                    statusCode: result.statusCode,
                    durationMs
                });
                return { suggestion: finalSuggestion };
            }
            this.settings.recordEvent({ level: "warn", scope, scenario, event: "discarded", prompt, message: textSuggestionDiscardMessage(content, normalized, suggestion, input), statusCode: result.statusCode, durationMs });
        }
        catch (caught) {
            this.settings.recordError({ scope, scenario, event: "error", prompt, message: errorMessage(caught), ...errorStatusCode(caught), durationMs: Date.now() - startedAt });
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
                prompt,
                message: `AI tag autocomplete completed: ${suggestions.length} usable suggestions.`,
                statusCode: result.statusCode,
                durationMs
            });
            return { suggestions };
        }
        catch (caught) {
            this.settings.recordError({ scope, scenario, event: "error", prompt, message: errorMessage(caught), ...errorStatusCode(caught), durationMs: Date.now() - startedAt });
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

export function isSuggestionWithinLimit(value: string, maxChars: number): boolean {
    return value.length > 0 && [...value].length <= maxChars && /[\p{L}\p{N}]/u.test(value);
}

export function isUsableTextSuggestion(value: string, input: Pick<AiTextSuggestionInput, "field" | "maxChars"> & Partial<Pick<AiTextSuggestionInput, "textBeforeCursor">>): boolean {
    if (!isSuggestionWithinLimit(value, input.maxChars)) return false;
    if (input.field === "description" && input.textBeforeCursor && !isUsefulDescriptionInsertion(value, input.textBeforeCursor)) return false;
    if (input.field === "comment" && input.textBeforeCursor && !isUsefulCommentInsertion(value, input.textBeforeCursor)) return false;
    return true;
}

export function normalizeSuggestion(value: string): string {
    return stripFencedText(stripModelReasoning(value));
}

export function normalizeTextSuggestion(value: string, _field?: AiTextSuggestionField): string {
    const normalized = normalizeSuggestion(value);
    const parsed = parseJsonObject(normalized);
    if (!parsed) return "";
    const text = parsed.insert;
    return typeof text === "string" ? text : "";
}

export function resolveTextSuggestion(raw: string, promptInput: object, input: AiTextSuggestionInput): {
    normalized: string;
    suggestion: string;
    finalSuggestion: string;
    usedFallback: boolean;
    usedShortened: boolean;
} {
    const normalized = normalizeTextSuggestion(raw, input.field);
    const suggestion = normalizeInsertionSuggestion(normalized, input.textBeforeCursor, input.textAfterCursor);
    const fallbackSuggestion = groundedHintFallback(promptInput, input);
    const shortenedSuggestion = fallbackSuggestion ? "" : shortenSuggestionToFit(suggestion, input);
    const preferGroundedHint = shouldPreferGroundedHint(suggestion, fallbackSuggestion, input);
    const finalSuggestion = isUsableTextSuggestion(suggestion, input) && !preferGroundedHint ? suggestion : fallbackSuggestion || shortenedSuggestion;
    return {
        normalized,
        suggestion,
        finalSuggestion,
        usedFallback: finalSuggestion === fallbackSuggestion && finalSuggestion !== suggestion,
        usedShortened: finalSuggestion === shortenedSuggestion && finalSuggestion !== suggestion
    };
}

export function normalizeInsertionSuggestion(value: string, textBeforeCursor: string, textAfterCursor: string): string {
    const withoutLeadingOverlap = stripLeadingOverlap(value.trim(), textBeforeCursor);
    return stripTrailingOverlap(withoutLeadingOverlap, textAfterCursor).trim();
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

function requestedEmptyCompletionReason(promptInput: object): string | undefined {
    const completionDecision = (promptInput as { completionDecision?: { returnEmpty?: boolean; reason?: unknown } }).completionDecision;
    if (!completionDecision?.returnEmpty) return undefined;
    return typeof completionDecision.reason === "string" && completionDecision.reason.trim()
        ? completionDecision.reason
        : "local contract requested an empty completion";
}

function groundedHintFallback(promptInput: object, input: AiTextSuggestionInput): string {
    const hint = (promptInput as { groundedContinuationHint?: unknown }).groundedContinuationHint;
    if (typeof hint !== "string" || !hint.trim()) return "";
    const suggestion = normalizeInsertionSuggestion(hint, input.textBeforeCursor, input.textAfterCursor);
    return isUsableTextSuggestion(suggestion, input) ? suggestion : "";
}

function shouldPreferGroundedHint(suggestion: string, groundedHint: string, input: AiTextSuggestionInput): boolean {
    if (!suggestion.trim() || !groundedHint.trim()) return false;

    if (input.field === "comment") {
        return shouldPreferGroundedCommentHint(suggestion, groundedHint, input.textBeforeCursor);
    }

    if (input.field !== "description") return false;

    const localLine = localCursorLine(input.textBeforeCursor, input.textAfterCursor).before.trim();
    const structuredMode = descriptionStructuredMode(input.textBeforeCursor, localLine);
    if (structuredMode) {
        return normalizeStructuredValue(suggestion) !== normalizeStructuredValue(groundedHint);
    }

    if (!/[、,，]/.test(groundedHint)) return false;
    if (!/[的:：]$/.test(localLine)) return false;

    const normalizedSuggestion = normalizeListItemMeaning(suggestion);
    const normalizedHint = normalizeListItemMeaning(groundedHint);
    if (!normalizedSuggestion || !normalizedHint.includes(normalizedSuggestion)) return false;
    return [...suggestion.trim()].length <= 2 && [...groundedHint.trim()].length > [...suggestion.trim()].length;
}

function descriptionStructuredMode(textBeforeCursor: string, lineBeforeCursor: string): "table" | "code" | "" {
    if ((textBeforeCursor.match(/```/g)?.length ?? 0) % 2 === 1) return "code";
    if (lineBeforeCursor.includes("|")) return "table";
    return "";
}

function normalizeStructuredValue(value: string): string {
    return value.trim().replace(/\s+/g, "");
}

function shouldPreferGroundedCommentHint(suggestion: string, groundedHint: string, textBeforeCursor: string): boolean {
    const localLine = localCursorLine(textBeforeCursor, "").before.trim();
    if (/^结论(?:\s|$)/u.test(localLine)) return suggestion.trim() !== groundedHint.trim();
    if (/^风险(?:\s|$)/u.test(localLine)) return suggestion.trim() !== groundedHint.trim();

    const mode = localCommentMode(localLine);
    if (mode === "action") {
        if (/^(?:需|需要|待)\s*/u.test(suggestion.trim()) && groundedHint.trim() !== suggestion.trim()) return true;
        if (groundedHint.includes("文档") && !suggestion.includes("文档") && groundedHint.trim() !== suggestion.trim()) return true;
        return false;
    }
    if (mode === "status") {
        if (/^(?:sync update|update|status)\b/i.test(localLine)) return groundedHint.trim() !== suggestion.trim();
        if (/^今天(?:\s|$)/u.test(localLine)) return groundedHint.trim() !== suggestion.trim();
        return /^已/u.test(suggestion.trim()) && groundedHint.trim() !== suggestion.trim();
    }
    if (mode === "reply") return [...suggestion.trim()].length <= 4 && [...groundedHint.trim()].length > [...suggestion.trim()].length;
    return false;
}

function localCommentMode(localLine: string): "reply" | "status" | "action" | "note" {
    const trimmed = localLine.trimStart().toLowerCase();
    if (/^(reply|re:)\b/.test(trimmed) || trimmed.startsWith("回复")) return "reply";
    if (/^(todo|action|next)\b/.test(trimmed) || trimmed.startsWith("下一步") || trimmed.startsWith("待办")) return "action";
    if (/^(status|update|sync update)\b/.test(trimmed) || trimmed.startsWith("进展") || trimmed.startsWith("状态") || trimmed.startsWith("今天") || trimmed.startsWith("今日")) return "status";
    return "note";
}

function shortenSuggestionToFit(value: string, input: AiTextSuggestionInput): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const candidates = [
        ...trimmed.split(/\n+/),
        ...trimmed.split(/[。.!?！？]/),
        ...trimmed.split(/[，,、；;]/)
    ].map((candidate) => candidate.trim()).filter(Boolean);
    for (const candidate of candidates) {
        if (candidate !== trimmed && isUsableTextSuggestion(candidate, input)) return candidate;
    }

    const sliced = [...trimmed].slice(0, input.maxChars).join("").trim();
    return isUsableTextSuggestion(sliced, input) ? sliced : "";
}

function isRepeatedDescriptionListItem(value: string, textBeforeCursor: string): boolean {
    const candidate = normalizeListItemMeaning(value);
    if (candidate.length < 8) return false;
    const localItem = normalizeListItemMeaning(localCursorLine(textBeforeCursor, "").before);
    const previousItems = previousListItems(textBeforeCursor).map(normalizeListItemMeaning);
    return [localItem, ...previousItems].some((item) => item.length >= 8 && (item === candidate || item.includes(candidate) || candidate.includes(item)));
}

function isUsefulDescriptionInsertion(value: string, textBeforeCursor: string): boolean {
    const localLine = localCursorLine(textBeforeCursor, "").before.trim();
    if (/^#{1,6}\s+\S+\s*$/.test(localLine)) return false;
    if (!/^(?:[-*+]\s*|\d+[.)]\s*)$/.test(localLine) && /[。.!！?？]$/.test(localLine)) return false;
    if (/^\d+[.)]\s*$/.test(localLine) && previousListContainsRequirementChecklist(textBeforeCursor)) return false;
    if (/^[-*+]\s/.test(localLine) && /^[-*+]\s/.test(value.trimStart())) return false;
    if (localLine.includes("|")) {
        const rowLabel = localLine.split("|").map((cell) => cell.trim()).filter(Boolean)[0] ?? "";
        if (rowLabel && normalizeListItemMeaning(value) === normalizeListItemMeaning(rowLabel)) return false;
    }
    if ((textBeforeCursor.match(/```/g)?.length ?? 0) % 2 === 1) {
        const propertyMatch = localLine.match(/"([^"\\]+)"\s*:\s*$/);
        if (propertyMatch?.[1] && normalizeListItemMeaning(value) === normalizeListItemMeaning(propertyMatch[1])) return false;
    }
    return !isRepeatedDescriptionListItem(value, textBeforeCursor) && !containsBlockedDescriptionInsertion(value, textBeforeCursor);
}

function containsBlockedDescriptionInsertion(value: string, textBeforeCursor: string): boolean {
    const candidate = normalizeListItemMeaning(value);
    if (candidate.length < 8) return false;
    return blockedDescriptionInsertions(textBeforeCursor)
        .map(normalizeListItemMeaning)
        .some((blocked) => blocked.length >= 8 && (candidate === blocked || candidate.includes(blocked) || blocked.includes(candidate) || overlapsRequirementChecklist(candidate, blocked)));
}

function overlapsRequirementChecklist(candidate: string, blocked: string): boolean {
    const checklistTerms = ["具体标的范围", "历史数据获取方式", "预期输出格式"];
    const sharedTerms = checklistTerms.filter((term) => candidate.includes(term) && blocked.includes(term));
    return sharedTerms.length >= 2;
}

function previousListContainsRequirementChecklist(textBeforeCursor: string): boolean {
    return previousListItems(textBeforeCursor)
        .map(normalizeListItemMeaning)
        .some((item) => overlapsRequirementChecklist(item, item));
}

function normalizeListItemMeaning(value: string): string {
    return value
        .trim()
        .replace(/^(?:[-*+]\s+|\d+[.)]\s*)/, "")
        .replace(/^需要/, "")
        .replace(/[\s，,。.!！?？、；;：:]/g, "");
}

function isAmbiguousCommentPrefix(textBeforeCursor: string): boolean {
    const localLine = localCursorLine(textBeforeCursor, "").before.trim();
    return /^(嗯|好|好的|收到|ok|okay)$/iu.test(localLine);
}

function isUsefulCommentInsertion(value: string, textBeforeCursor: string): boolean {
    if (isAmbiguousCommentPrefix(textBeforeCursor)) return false;
    const localLine = localCursorLine(textBeforeCursor, "").before.trim();
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed === localLine) return false;
    if (/^(?:reply|re:|回复|status|update|sync update:)\s*$/iu.test(trimmed)) return false;
    if (/^(?:reply|re:|回复|进展|状态|status|update|sync update:)/iu.test(localLine) && [...trimmed].length < 2) return false;
    return true;
}

function textSuggestionScenario(field: AiTextSuggestionField): string {
    if (field === "description") return "inline-completion.description";
    if (field === "subtask") return "inline-completion.subtask";
    return "inline-completion.comment";
}

function textSuggestionDiscardMessage(raw: string, normalized: string, suggestion: string, input: AiTextSuggestionInput): string {
    if (!raw.trim()) return "AI suggestion discarded: provider returned empty content.";
    if (!normalized.trim()) return "AI suggestion discarded: content only contained reasoning or formatting.";
    if (!suggestion.trim()) return "AI suggestion discarded: content repeated cursor context.";
    if (!isSuggestionWithinLimit(suggestion, input.maxChars)) return `AI suggestion discarded: ${[...suggestion].length} characters exceeds ${input.maxChars}.`;
    if (input.field === "description" && input.textBeforeCursor && !isUsefulDescriptionInsertion(suggestion, input.textBeforeCursor)) {
        return "AI suggestion discarded: content conflicted with nearby description context.";
    }
    if (input.field === "comment" && input.textBeforeCursor && isAmbiguousCommentPrefix(input.textBeforeCursor)) {
        return "AI suggestion discarded: comment prefix is too ambiguous for a grounded continuation.";
    }
    return "AI suggestion discarded: content failed local usefulness checks.";
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

function looksLikeJsonOutput(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function stripLeadingOverlap(value: string, textBeforeCursor: string): string {
    const maxOverlap = Math.min(value.length, textBeforeCursor.length);
    for (let length = maxOverlap; length > 0; length -= 1) {
        if (textBeforeCursor.endsWith(value.slice(0, length))) return value.slice(length);
    }
    return value;
}

function stripTrailingOverlap(value: string, textAfterCursor: string): string {
    const maxOverlap = Math.min(value.length, textAfterCursor.length);
    for (let length = maxOverlap; length > 0; length -= 1) {
        if (textAfterCursor.startsWith(value.slice(value.length - length))) return value.slice(0, value.length - length);
    }
    return value;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && (error.name === "AbortError" || error.message === "This operation was aborted")) return "AI suggestion timed out.";
    return error instanceof Error ? error.message : String(error);
}

function errorStatusCode(error: unknown): { statusCode?: number } {
    return error instanceof CompletionError && error.statusCode !== undefined ? { statusCode: error.statusCode } : {};
}