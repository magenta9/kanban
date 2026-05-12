import { describe, expect, it } from "vitest";
import { formatDateRange, normalizeDateRange, shouldSyncRichTextEditorContent } from "./kanban";

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

describe("date range helpers", () => {
    it("normalizes reversed date ranges", () => {
        expect(normalizeDateRange(3, 1)).toEqual({ startDate: 1, endDate: 3 });
        expect(normalizeDateRange(1, 3)).toEqual({ startDate: 1, endDate: 3 });
    });

    it("formats an empty range", () => {
        expect(formatDateRange()).toBe("No date");
    });
});
