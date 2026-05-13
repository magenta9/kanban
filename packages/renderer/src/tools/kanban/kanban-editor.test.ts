import { describe, expect, it } from "vitest";
import { applyRichTextListContinuation, formatDateRange, isRichTextListActive, isRichTextListContinuationShortcut, isRichTextSubmitShortcut, normalizeDateRange, shouldSyncRichTextEditorContent } from "./kanban";

const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] };
const documentWithText = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }]
};

describe("shouldSyncRichTextEditorContent", () => {
    it("syncs when current and next values differ", () => {
        expect(shouldSyncRichTextEditorContent(emptyDocument, documentWithText)).toBe(true);
    });

    it("skips redundant syncs when values are identical", () => {
        expect(shouldSyncRichTextEditorContent(emptyDocument, emptyDocument)).toBe(false);
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

describe("date range helpers", () => {
    it("normalizes reversed date ranges", () => {
        expect(normalizeDateRange(3, 1)).toEqual({ startDate: 1, endDate: 3 });
        expect(normalizeDateRange(1, 3)).toEqual({ startDate: 1, endDate: 3 });
    });

    it("formats an empty range", () => {
        expect(formatDateRange()).toBe("No date");
    });
});
