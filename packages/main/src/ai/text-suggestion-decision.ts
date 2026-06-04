import type { AiTextSuggestionDecision, AiTextSuggestionDecisionReason, AiTextSuggestionField, AiTextSuggestionInput } from "@kanban/shared";

interface InsertionResolution {
    suggestion: string;
    emptyReason?: AiTextSuggestionDecisionReason;
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

export function resolveTextSuggestion(raw: string, input: AiTextSuggestionInput): {
    normalized: string;
    suggestion: string;
    decision: AiTextSuggestionDecision;
} {
    const normalized = normalizeTextSuggestion(raw, input.field);
    const resolved = resolveInsertionSuggestion(normalized, input.textBeforeCursor, input.textAfterCursor, input.field);
    return {
        normalized,
        suggestion: resolved.suggestion,
        decision: textSuggestionResolutionDecision(raw, normalized, resolved)
    };
}

export function normalizeInsertionSuggestion(value: string, textBeforeCursor: string, textAfterCursor: string): string {
    return resolveInsertionSuggestion(value, textBeforeCursor, textAfterCursor).suggestion;
}

export function requestedEmptyCompletionReason(promptInput: object): string | undefined {
    const completionDecision = (promptInput as { completionDecision?: { returnEmpty?: boolean; reason?: unknown } }).completionDecision;
    if (!completionDecision?.returnEmpty) return undefined;
    return typeof completionDecision.reason === "string" && completionDecision.reason.trim()
        ? completionDecision.reason
        : "local contract requested an empty completion";
}

export function textSuggestionScenario(field: AiTextSuggestionField): string {
    if (field === "description") return "inline-completion.description";
    if (field === "subtask") return "inline-completion.subtask";
    return "inline-completion.comment";
}

export function textSuggestionDiscardMessage(raw: string, normalized: string, suggestion: string): string {
    if (!raw.trim()) return "AI suggestion discarded: provider returned empty content.";
    if (!normalized.trim()) return "AI suggestion discarded: content only contained reasoning or formatting.";
    if (!suggestion.trim()) return "AI suggestion discarded: content repeated cursor context.";
    return "AI suggestion discarded: content became empty after cursor-fit normalization.";
}

export function textSuggestionDecision(status: AiTextSuggestionDecision["status"], reason: AiTextSuggestionDecisionReason, detail?: string): AiTextSuggestionDecision {
    return detail ? { status, reason, detail } : { status, reason };
}

export function promptEmptyDecisionReason(field: AiTextSuggestionField, detail: string): AiTextSuggestionDecisionReason {
    if (field === "subtask" && detail === "subtask prefix would duplicate a sibling subtask") return "subtask_duplicate_context";
    if (field === "comment" && detail === "comment intent is too ambiguous for a grounded completion") return "comment_intent_ambiguous";
    return "prompt_return_empty";
}

function resolveInsertionSuggestion(value: string, textBeforeCursor: string, textAfterCursor: string, field?: AiTextSuggestionField): InsertionResolution {
    const withoutLeadingOverlap = stripLeadingOverlap(value.trim(), textBeforeCursor);
    if (value.trim() && !withoutLeadingOverlap.trim()) return { suggestion: "", emptyReason: "cursor_context_repeated" };

    const withoutTrailingOverlap = stripTrailingOverlap(withoutLeadingOverlap, textAfterCursor);
    if (withoutLeadingOverlap.trim() && !withoutTrailingOverlap.trim()) return { suggestion: "", emptyReason: "cursor_context_repeated" };

    const withoutTrailingDuplicate = stripTrailingDuplicateSuffixLine(withoutTrailingOverlap, textAfterCursor);
    if (withoutTrailingOverlap.trim() && !withoutTrailingDuplicate.trim()) return { suggestion: "", emptyReason: duplicateContextReason(field) };

    const withoutRepeatedNearby = stripRepeatedNearbyInsertion(withoutTrailingDuplicate, textBeforeCursor, textAfterCursor).trim();
    if (withoutTrailingDuplicate.trim() && !withoutRepeatedNearby.trim()) return { suggestion: "", emptyReason: duplicateContextReason(field) };
    return { suggestion: withoutRepeatedNearby };
}

function textSuggestionResolutionDecision(raw: string, normalized: string, resolved: InsertionResolution): AiTextSuggestionDecision {
    if (resolved.suggestion.trim()) return textSuggestionDecision("accepted", "accepted");
    if (!raw.trim()) return textSuggestionDecision("discarded", "provider_empty_content");
    if (!normalized.trim()) return textSuggestionDecision("discarded", "structured_output_empty");
    if (resolved.emptyReason) return textSuggestionDecision("discarded", resolved.emptyReason);
    return textSuggestionDecision("discarded", "cursor_fit_empty");
}

function duplicateContextReason(field?: AiTextSuggestionField): AiTextSuggestionDecisionReason {
    return field === "description" ? "description_duplicate_context" : "cursor_context_repeated";
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

function stripTrailingDuplicateSuffixLine(value: string, textAfterCursor: string): string {
    if (!value.trim() || !textAfterCursor.trim()) return value;

    const suggestionLines = value.split("\n");
    const lastLineIndex = findLastNonEmptyLineIndex(suggestionLines);
    if (lastLineIndex < 0) return value;

    const suffixLines = textAfterCursor.split("\n");
    const firstSuffixLine = suffixLines.find((line) => line.trim());
    if (!firstSuffixLine) return value;

    const suggestionLineKey = inlineLineKey(suggestionLines[lastLineIndex] ?? "");
    const suffixLineKey = inlineLineKey(firstSuffixLine);
    if (suggestionLineKey.length < 6 || suggestionLineKey !== suffixLineKey) return value;

    suggestionLines.splice(lastLineIndex, 1);
    while (suggestionLines.length > 0 && !suggestionLines[suggestionLines.length - 1]?.trim()) suggestionLines.pop();
    return suggestionLines.join("\n");
}

function findLastNonEmptyLineIndex(lines: string[]): number {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index]?.trim()) return index;
    }
    return -1;
}

function inlineLineKey(value: string): string {
    return value.trim().replace(/\s+/g, "").replace(/[。.!！?？]+$/u, "");
}

function stripRepeatedNearbyInsertion(value: string, textBeforeCursor: string, textAfterCursor: string): string {
    const lines = value.split("\n");
    if (lines.length > 1) return stripRepeatedNearbyLines(value, textBeforeCursor, textAfterCursor);

    const key = inlineLineKey(value);
    if (key.length < 6) return value;

    return nearbyLineKeys(textBeforeCursor, textAfterCursor).has(key) ? "" : value;
}

function stripRepeatedNearbyLines(value: string, textBeforeCursor: string, textAfterCursor: string): string {
    const lines = value.split("\n");
    if (lines.length <= 1) return value;

    const nearbyKeys = nearbyLineKeys(textBeforeCursor, textAfterCursor);
    const seenLineKeys = new Set<string>();
    const keptLines: string[] = [];

    for (const line of lines) {
        if (!line.trim()) {
            if (keptLines.length > 0) keptLines.push(line);
            continue;
        }

        const key = inlineLineKey(line);
        if (key.length >= 4 && seenLineKeys.has(key)) break;
        if (key.length >= 6 && nearbyKeys.has(key)) break;
        keptLines.push(line);
        if (key.length >= 4) seenLineKeys.add(key);
    }

    while (keptLines.length > 0 && !keptLines[keptLines.length - 1]?.trim()) keptLines.pop();
    return keptLines.join("\n");
}

function nearbyLineKeys(textBeforeCursor: string, textAfterCursor: string): Set<string> {
    return new Set([
        ...textBeforeCursor.split("\n").map((line) => inlineLineKey(line)).filter((line) => line.length >= 6).slice(-6),
        ...textAfterCursor.split("\n").map((line) => inlineLineKey(line)).filter((line) => line.length >= 6).slice(0, 2)
    ]);
}
