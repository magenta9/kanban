import { describe, expect, it } from "vitest";
import {
    applyRichTextListIndentation,
    applyRichTextListContinuation,
    findRichTextMarkdownLinkSuffix,
    formatDateRange,
    isRichTextListActive,
    isRichTextListIndentShortcut,
    isRichTextListContinuationShortcut,
    isRichTextSubmitShortcut,
    normalizeDateRange,
    parseRichTextMarkdownLink,
    resolveRichTextLinkPaste,
    shouldSyncRichTextEditorContent
} from "./kanban";

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

describe("date range helpers", () => {
    it("normalizes reversed date ranges", () => {
        expect(normalizeDateRange(3, 1)).toEqual({ startDate: 1, endDate: 3 });
        expect(normalizeDateRange(1, 3)).toEqual({ startDate: 1, endDate: 3 });
    });

    it("formats an empty range", () => {
        expect(formatDateRange()).toBe("No date");
    });
});
