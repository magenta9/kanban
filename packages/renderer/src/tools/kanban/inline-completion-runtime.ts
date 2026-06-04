import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { AiSuggestionCardContext, AiTextSuggestionField } from "@kanban/shared";
import { getApi } from "../../api";
import { shouldApplyInlineCompletion, shouldRequestInlineCompletion } from "./kanban-helpers";

export interface CursorText {
    before: string;
    after: string;
}

export interface RichTextCompletionConfig {
    field: AiTextSuggestionField;
    minChars: number;
    maxChars: number;
    context: AiSuggestionCardContext;
}

export interface RichTextCompletionState {
    focused: boolean;
    suggestion: string;
    cursor: CursorText | null;
}

export interface RichTextCompletionRequestState {
    requestId: number;
    lastRequestSignature: string;
    timeout?: number;
}

type RichTextCompletionMeta =
    | { type: "focus" }
    | { type: "blur" }
    | { type: "clear" }
    | { type: "suggest"; suggestion: string; cursor: CursorText };

export const richTextCompletionPluginKey = new PluginKey<RichTextCompletionState>("kanbanRichTextCompletion");

export function useInlineCompletion<TElement extends HTMLInputElement | HTMLTextAreaElement>({ value, minChars, maxChars, field, context, elementRef }: {
    value: string;
    minChars: number;
    maxChars: number;
    field: AiTextSuggestionField;
    context: AiSuggestionCardContext;
    elementRef: MutableRefObject<TElement | null>;
}): {
    suggestion: string;
    cursor: CursorText;
    refreshCursor: () => void;
    clearSuggestion: () => void;
    focusCompletion: () => void;
    blurCompletion: () => void;
    acceptSuggestion: () => string | null;
} {
    const [suggestion, setSuggestion] = useState("");
    const [cursor, setCursor] = useState<CursorText>({ before: value, after: "" });
    const [focused, setFocused] = useState(false);
    const [requestTick, setRequestTick] = useState(0);
    const requestIdRef = useRef(0);
    const contextRef = useRef(context);

    useEffect(() => {
        contextRef.current = context;
    }, [context]);

    function currentCursor(): CursorText {
        const element = elementRef.current;
        const currentValue = element?.value ?? value;
        const start = element?.selectionStart ?? currentValue.length;
        const end = element?.selectionEnd ?? start;
        return { before: currentValue.slice(0, start), after: currentValue.slice(end) };
    }

    function refreshCursor(): void {
        setSuggestion("");
        setCursor(currentCursor());
        requestIdRef.current += 1;
        if (focused) setRequestTick((current) => current + 1);
    }

    function clearSuggestion(): void {
        setSuggestion("");
        requestIdRef.current += 1;
    }

    function focusCompletion(): void {
        setFocused(true);
        setCursor(currentCursor());
        setSuggestion("");
        requestIdRef.current += 1;
        setRequestTick((current) => current + 1);
    }

    function blurCompletion(): void {
        setFocused(false);
        setSuggestion("");
        requestIdRef.current += 1;
    }

    function acceptSuggestion(): string | null {
        if (!suggestion) return null;
        const liveCursor = currentCursor();
        if (!shouldApplyInlineCompletion(cursor, liveCursor, minChars, focused)) {
            setSuggestion("");
            requestIdRef.current += 1;
            return null;
        }
        const nextValue = `${liveCursor.before}${suggestion}${liveCursor.after}`;
        setSuggestion("");
        requestIdRef.current += 1;
        window.requestAnimationFrame(() => {
            const nextPosition = liveCursor.before.length + suggestion.length;
            elementRef.current?.setSelectionRange(nextPosition, nextPosition);
        });
        return nextValue;
    }

    useEffect(() => {
        const nextCursor = currentCursor();
        setCursor(nextCursor);
        setSuggestion("");
        const activeRequestId = requestIdRef.current + 1;
        requestIdRef.current = activeRequestId;
        if (!shouldRequestInlineCompletion(nextCursor.before, nextCursor.after, minChars, focused)) return;
        const requestedCursor = nextCursor;
        const timeout = window.setTimeout(() => {
            void getApi().ai.suggestText({ field, textBeforeCursor: nextCursor.before, textAfterCursor: nextCursor.after, maxChars, context: contextRef.current })
                .then((result) => {
                    const liveCursor = currentCursor();
                    if (requestIdRef.current === activeRequestId && shouldApplyInlineCompletion(requestedCursor, liveCursor, minChars, focused)) {
                        setSuggestion(result.suggestion ?? "");
                    }
                })
                .catch(() => {
                    if (requestIdRef.current === activeRequestId) setSuggestion("");
                });
        }, 500);
        return () => window.clearTimeout(timeout);
    }, [value, minChars, maxChars, field, elementRef, focused, requestTick]);

    return { suggestion, cursor, refreshCursor, clearSuggestion, focusCompletion, blurCompletion, acceptSuggestion };
}

export function createRichTextCompletionExtension(configRef: MutableRefObject<RichTextCompletionConfig | undefined>): Extension {
    return Extension.create({
        name: "kanbanInlineCompletion",
        addProseMirrorPlugins() {
            return [
                new Plugin<RichTextCompletionState>({
                    key: richTextCompletionPluginKey,
                    state: {
                        init: () => ({ focused: false, suggestion: "", cursor: null }),
                        apply: (transaction, previous) => {
                            const meta = transaction.getMeta(richTextCompletionPluginKey) as RichTextCompletionMeta | undefined;
                            if (meta?.type === "focus") return { ...previous, focused: true, suggestion: "", cursor: null };
                            if (meta?.type === "blur") return { focused: false, suggestion: "", cursor: null };
                            if (meta?.type === "clear") return { ...previous, suggestion: "", cursor: null };
                            if (meta?.type === "suggest") return { ...previous, suggestion: meta.suggestion, cursor: meta.cursor };
                            if (transaction.docChanged || transaction.selectionSet) return { ...previous, suggestion: "", cursor: null };
                            return previous;
                        }
                    },
                    props: {
                        decorations: (state) => {
                            const completion = richTextCompletionPluginKey.getState(state);
                            if (!completion?.suggestion || !state.selection.empty) return DecorationSet.empty;
                            const widget = Decoration.widget(state.selection.from, () => {
                                const element = document.createElement("span");
                                element.className = "kanban-editor-completion-ghost";
                                element.textContent = completion.suggestion;
                                return element;
                            }, { key: `kanban-editor-completion:${completion.suggestion}`, side: 1 });
                            return DecorationSet.create(state.doc, [widget]);
                        },
                        handleDOMEvents: {
                            focus: (view) => {
                                view.dispatch(view.state.tr.setMeta(richTextCompletionPluginKey, { type: "focus" } satisfies RichTextCompletionMeta));
                                return false;
                            },
                            blur: (view) => {
                                view.dispatch(view.state.tr.setMeta(richTextCompletionPluginKey, { type: "blur" } satisfies RichTextCompletionMeta));
                                return false;
                            }
                        }
                    }
                })
            ];
        }
    });
}

export function richTextCursor(view: EditorView): CursorText {
    const { selection, doc } = view.state;
    return {
        before: doc.textBetween(0, selection.from, "\n", "\n"),
        after: doc.textBetween(selection.to, doc.content.size, "\n", "\n")
    };
}

export function normalizeRichTextInlineSuggestion(value: string): string {
    return value.replace(/\s*\n+\s*/g, " ").trimStart();
}

export function clearRichTextCompletionRequest(requestState: RichTextCompletionRequestState): void {
    if (requestState.timeout !== undefined) window.clearTimeout(requestState.timeout);
    requestState.timeout = undefined;
}

export function scheduleRichTextCompletionRequest(editor: Editor, configRef: MutableRefObject<RichTextCompletionConfig | undefined>, requestState: RichTextCompletionRequestState): void {
    const requestConfig = configRef.current;
    const completionState = richTextCompletionPluginKey.getState(editor.state);
    if (!editor.view.hasFocus()) {
        requestState.lastRequestSignature = "";
        clearRichTextCompletionRequest(requestState);
        return;
    }
    if (!requestConfig || completionState?.suggestion || !editor.state.selection.empty) {
        clearRichTextCompletionRequest(requestState);
        return;
    }

    const cursor = richTextCursor(editor.view);
    if (!shouldRequestInlineCompletion(cursor.before, cursor.after, requestConfig.minChars, editor.view.hasFocus())) {
        clearRichTextCompletionRequest(requestState);
        return;
    }

    const requestSignature = `${editor.state.selection.from}:${cursor.before}:${cursor.after}`;
    if (requestSignature === requestState.lastRequestSignature) return;
    requestState.lastRequestSignature = requestSignature;
    clearRichTextCompletionRequest(requestState);

    const activeRequestId = requestState.requestId + 1;
    requestState.requestId = activeRequestId;
    requestState.timeout = window.setTimeout(() => {
        const activeConfig = configRef.current;
        if (!activeConfig) return;
        void getApi().ai.suggestText({
            field: activeConfig.field,
            textBeforeCursor: cursor.before,
            textAfterCursor: cursor.after,
            maxChars: activeConfig.maxChars,
            context: activeConfig.context
        }).then((result) => {
            if (requestState.requestId !== activeRequestId) return;
            const liveCursor = richTextCursor(editor.view);
            const suggestion = normalizeRichTextInlineSuggestion(result.suggestion ?? "");
            if (!suggestion || !editor.view.hasFocus() || !shouldApplyInlineCompletion(cursor, liveCursor, activeConfig.minChars, editor.view.hasFocus())) return;
            editor.view.dispatch(editor.state.tr.setMeta(richTextCompletionPluginKey, { type: "suggest", suggestion, cursor } satisfies RichTextCompletionMeta));
        }).catch(() => {
            if (requestState.requestId === activeRequestId) {
                editor.view.dispatch(editor.state.tr.setMeta(richTextCompletionPluginKey, { type: "clear" } satisfies RichTextCompletionMeta));
            }
        });
    }, 500);
}

export function acceptRichTextCompletion(editor: Editor): boolean {
    const view = editor.view;
    const state = richTextCompletionPluginKey.getState(view.state);
    if (!state?.suggestion || !state.cursor) return false;
    const liveCursor = richTextCursor(view);
    if (state.cursor.before !== liveCursor.before || state.cursor.after !== liveCursor.after) {
        view.dispatch(view.state.tr.setMeta(richTextCompletionPluginKey, { type: "clear" } satisfies RichTextCompletionMeta));
        return false;
    }
    view.dispatch(view.state.tr.insertText(state.suggestion, view.state.selection.from, view.state.selection.to).setMeta(richTextCompletionPluginKey, { type: "clear" } satisfies RichTextCompletionMeta));
    return true;
}
