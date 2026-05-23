import { describe, expect, it } from "vitest";
import {
    applyRichTextListIndentation,
    applyRichTextListContinuation,
    findRichTextMarkdownLinkSuffix,
    formatDateRange,
    draftCardsForAiContext,
    isMarkdownSubmitShortcut,
    isRichTextListActive,
    isRichTextListIndentShortcut,
    isRichTextListContinuationShortcut,
    isRichTextSubmitShortcut,
    normalizeDateRange,
    parseRichTextMarkdownLink,
    relatedCardsForAiContext,
    recurrenceSummary,
    resolveRichTextLinkPaste,
    stableLabelColor,
    suggestBoardLabelsByPrefix,
    isInlineCompletionAcceptShortcut,
    shouldApplyInlineCompletion,
    shouldRequestInlineCompletion,
    shouldSyncRichTextEditorContent,
    buildLabelPrefixIndex
} from "./kanban-helpers";
import type { KanbanCard, KanbanLabel } from "@kanban/shared";

const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] };
const documentWithText = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }]
};

function testCard(patch: Partial<KanbanCard>): KanbanCard {
    return {
        id: "card",
        boardId: "board",
        columnId: "todo",
        title: "Card",
        priority: "none",
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
        labelIds: [],
        subtasks: [],
        comments: [],
        ...patch
    };
}

function testLabel(id: string, name: string): KanbanLabel {
    return { id, boardId: "board", name, color: "#64748b" };
}

describe("shouldSyncRichTextEditorContent", () => {
    it("syncs when current and next values differ", () => {
        expect(shouldSyncRichTextEditorContent(emptyDocument, documentWithText)).toBe(true);
    });

    it("skips redundant syncs when values are identical", () => {
        expect(shouldSyncRichTextEditorContent(emptyDocument, emptyDocument)).toBe(false);
    });
});

describe("parseRichTextMarkdownLink", () => {
    it("parses markdown link syntax into a label and href", () => {
        expect(parseRichTextMarkdownLink("[Roadmap](https://example.com/roadmap)")).toEqual({
            label: "Roadmap",
            url: "https://example.com/roadmap"
        });
    });

    it("ignores non-http links", () => {
        expect(parseRichTextMarkdownLink("[Mail](mailto:test@example.com)")).toBeNull();
    });
});

describe("findRichTextMarkdownLinkSuffix", () => {
    it("locates a markdown link at the end of a paragraph", () => {
        expect(findRichTextMarkdownLinkSuffix("See [Roadmap](https://example.com/roadmap)")).toEqual({
            label: "Roadmap",
            url: "https://example.com/roadmap",
            start: 4,
            end: 42
        });
    });

    it("skips paragraphs without a trailing markdown link", () => {
        expect(findRichTextMarkdownLinkSuffix("See [Roadmap](https://example.com/roadmap) later")).toBeNull();
    });
});

describe("resolveRichTextLinkPaste", () => {
    it("turns a pasted bare url into a placeholder link", () => {
        expect(resolveRichTextLinkPaste("https://example.com/roadmap")).toEqual({
            label: "link",
            url: "https://example.com/roadmap",
            selectLabel: true
        });
    });

    it("preserves explicit markdown link labels on paste", () => {
        expect(resolveRichTextLinkPaste("[Roadmap](https://example.com/roadmap)")).toEqual({
            label: "Roadmap",
            url: "https://example.com/roadmap",
            selectLabel: false
        });
    });

    it("ignores non-link text", () => {
        expect(resolveRichTextLinkPaste("Roadmap")).toBeNull();
    });
});

describe("isRichTextSubmitShortcut", () => {
    it("submits on Enter without Shift", () => {
        expect(isRichTextSubmitShortcut({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    });

    it("keeps Shift+Enter available for new lines", () => {
        expect(isRichTextSubmitShortcut({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
    });

    it("does not submit while composing text", () => {
        expect(isRichTextSubmitShortcut({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    });
});

describe("isMarkdownSubmitShortcut", () => {
    it("submits on Enter without Shift", () => {
        expect(isMarkdownSubmitShortcut({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
    });

    it("keeps Shift+Enter available for Markdown newlines", () => {
        expect(isMarkdownSubmitShortcut({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
    });

    it("does not submit while composing text", () => {
        expect(isMarkdownSubmitShortcut({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    });
});

describe("AI context helpers", () => {
    it("uses shared-label recent active cards for existing card context", () => {
        const current = testCard({ id: "current", labelIds: ["bug"] });
        const matchingNewer = testCard({ id: "matching-newer", labelIds: ["bug"], updatedAt: 4 });
        const matchingOlder = testCard({ id: "matching-older", labelIds: ["bug"], updatedAt: 2 });
        const unrelated = testCard({ id: "unrelated", labelIds: ["feature"], updatedAt: 5 });
        const archived = testCard({ id: "archived", labelIds: ["bug"], updatedAt: 6, archivedAt: 7 });

        expect(relatedCardsForAiContext(current, [current, matchingOlder, unrelated, matchingNewer, archived]).map((card) => card.id)).toEqual([
            "matching-newer",
            "matching-older"
        ]);
    });

    it("uses current-column recent active cards for draft context", () => {
        const newest = testCard({ id: "newest", columnId: "todo", updatedAt: 4 });
        const older = testCard({ id: "older", columnId: "todo", updatedAt: 2 });
        const otherColumn = testCard({ id: "other", columnId: "doing", updatedAt: 5 });

        expect(draftCardsForAiContext("todo", [older, otherColumn, newest]).map((card) => card.id)).toEqual(["newest", "older"]);
    });

    it("returns stable label colors for same board and normalized name", () => {
        expect(stableLabelColor("board", " Product  Ops ")).toBe(stableLabelColor("board", "product ops"));
    });
});

describe("board label prefix suggestions", () => {
    const labels = [testLabel("trade", "Trade"), testLabel("bug", "Bug"), testLabel("backend", "Backend")];

    it("builds a case-insensitive prefix index for board labels", () => {
        const index = buildLabelPrefixIndex(labels);
        expect(index.get("b")?.map((label) => label.name)).toEqual(["Backend", "Bug"]);
        expect(index.get("tr")?.map((label) => label.name)).toEqual(["Trade"]);
    });

    it("suggests unattached board labels by prefix", () => {
        expect(suggestBoardLabelsByPrefix(labels, ["backend"], "b", 5)).toEqual([{ name: "Bug", existingLabelId: "bug" }]);
    });

    it("uses the empty prefix for initial local tag suggestions", () => {
        expect(suggestBoardLabelsByPrefix(labels, [], "", 2)).toEqual([
            { name: "Backend", existingLabelId: "backend" },
            { name: "Bug", existingLabelId: "bug" }
        ]);
    });
});

describe("inline completion focus guard", () => {
    it("does not request suggestions for an unfocused mounted field", () => {
        expect(shouldRequestInlineCompletion("复盘持有标的", "", 2, false)).toBe(false);
    });

    it("requests suggestions only when focused at the end and over the minimum length", () => {
        expect(shouldRequestInlineCompletion("复盘", "", 2, true)).toBe(true);
        expect(shouldRequestInlineCompletion("复盘", "持有标的", 2, true)).toBe(false);
        expect(shouldRequestInlineCompletion(" ", "", 2, true)).toBe(false);
    });

    it("does not apply stale suggestions after the cursor moves", () => {
        expect(shouldApplyInlineCompletion({ before: "复盘持有标的", after: "" }, { before: "复盘", after: "持有标的" }, 2, true)).toBe(false);
        expect(shouldApplyInlineCompletion({ before: "复盘持有标的", after: "" }, { before: "复盘持有标的", after: "" }, 2, true)).toBe(true);
    });

    it("accepts inline suggestions with Tab only", () => {
        expect(isInlineCompletionAcceptShortcut("Tab", "description")).toBe(true);
        expect(isInlineCompletionAcceptShortcut("Tab", "subtask")).toBe(true);
        expect(isInlineCompletionAcceptShortcut("ArrowRight", "description")).toBe(false);
        expect(isInlineCompletionAcceptShortcut("End", "comment")).toBe(false);
    });
});

describe("isRichTextListContinuationShortcut", () => {
    it("continues lists on Shift+Enter", () => {
        expect(isRichTextListContinuationShortcut({ key: "Enter", shiftKey: true, isComposing: false })).toBe(true);
    });

    it("does not claim plain Enter", () => {
        expect(isRichTextListContinuationShortcut({ key: "Enter", shiftKey: false, isComposing: false })).toBe(false);
    });

    it("does not continue lists while composing text", () => {
        expect(isRichTextListContinuationShortcut({ key: "Enter", shiftKey: true, isComposing: true })).toBe(false);
    });
});

describe("isRichTextListIndentShortcut", () => {
    it("handles Tab as the list indent shortcut", () => {
        expect(isRichTextListIndentShortcut({ key: "Tab", shiftKey: false, isComposing: false })).toBe(true);
    });

    it("ignores composing input", () => {
        expect(isRichTextListIndentShortcut({ key: "Tab", shiftKey: false, isComposing: true })).toBe(false);
    });
});

describe("isRichTextListActive", () => {
    it("detects ordered lists", () => {
        expect(isRichTextListActive({ isActive: (name: string) => name === "orderedList" })).toBe(true);
    });

    it("detects bullet lists", () => {
        expect(isRichTextListActive({ isActive: (name: string) => name === "bulletList" })).toBe(true);
    });

    it("ignores non-list editor states", () => {
        expect(isRichTextListActive({ isActive: () => false })).toBe(false);
    });
});

describe("applyRichTextListContinuation", () => {
    it("splits a populated list item into the next item", () => {
        const calls: string[] = [];

        const handled = applyRichTextListContinuation({
            isActive: (name: string) => name === "orderedList",
            commands: {
                splitListItem: () => {
                    calls.push("split");
                    return true;
                },
                liftListItem: () => {
                    calls.push("lift");
                    return true;
                }
            }
        });

        expect(handled).toBe(true);
        expect(calls).toEqual(["split"]);
    });

    it("lifts an empty list item out of the current list when it cannot split", () => {
        const calls: string[] = [];

        const handled = applyRichTextListContinuation({
            isActive: (name: string) => name === "orderedList",
            commands: {
                splitListItem: () => {
                    calls.push("split");
                    return false;
                },
                liftListItem: () => {
                    calls.push("lift");
                    return true;
                }
            }
        });

        expect(handled).toBe(true);
        expect(calls).toEqual(["split", "lift"]);
    });

    it("reports unhandled when neither list command applies", () => {
        expect(applyRichTextListContinuation({
            isActive: () => false,
            commands: {
                splitListItem: () => false,
                liftListItem: () => false
            }
        })).toBe(false);
    });
});

describe("applyRichTextListIndentation", () => {
    it("indents the current list item on Tab", () => {
        const calls: string[] = [];

        const handled = applyRichTextListIndentation({
            isActive: (name: string) => name === "bulletList",
            commands: {
                sinkListItem: () => {
                    calls.push("sink");
                    return true;
                },
                liftListItem: () => {
                    calls.push("lift");
                    return true;
                }
            }
        }, false);

        expect(handled).toBe(true);
        expect(calls).toEqual(["sink"]);
    });

    it("outdents the current list item on Shift+Tab", () => {
        const calls: string[] = [];

        const handled = applyRichTextListIndentation({
            isActive: (name: string) => name === "orderedList",
            commands: {
                sinkListItem: () => {
                    calls.push("sink");
                    return true;
                },
                liftListItem: () => {
                    calls.push("lift");
                    return true;
                }
            }
        }, true);

        expect(handled).toBe(true);
        expect(calls).toEqual(["lift"]);
    });

    it("does nothing outside list contexts", () => {
        expect(applyRichTextListIndentation({
            isActive: () => false,
            commands: {
                sinkListItem: () => false,
                liftListItem: () => false
            }
        }, false)).toBe(false);
    });
});

describe("recurrenceSummary", () => {
    it("formats active fixed recurrence", () => {
        expect(recurrenceSummary({
            id: "card-1",
            boardId: "board-1",
            columnId: "column-1",
            title: "Review",
            priority: "none",
            sortOrder: 1000,
            createdAt: 1,
            updatedAt: 1,
            labelIds: [],
            subtasks: [],
            comments: [],
            recurrence: { seriesId: "series-1", trigger: "fixed", cycle: "weekly", status: "active" }
        })).toBe("每周 · 固定时间");
    });

    it("formats blocked recurrence with its reason", () => {
        expect(recurrenceSummary({
            id: "card-1",
            boardId: "board-1",
            columnId: "column-1",
            title: "Review",
            priority: "none",
            sortOrder: 1000,
            createdAt: 1,
            updatedAt: 1,
            labelIds: [],
            subtasks: [],
            comments: [],
            recurrence: { seriesId: "series-1", trigger: "completion", cycle: "daily", status: "blocked", blockedReason: "请选择一个可用的完成列。" }
        })).toBe("已阻塞：请选择一个可用的完成列。");
    });
});

describe("date range helpers", () => {
    it("normalizes reversed date ranges", () => {
        expect(normalizeDateRange(3, 1)).toEqual({ startDate: 1, endDate: 3 });
        expect(normalizeDateRange(1, 3)).toEqual({ startDate: 1, endDate: 3 });
    });

    it("formats an empty range", () => {
        expect(formatDateRange()).toBe("No date");
    });
});
