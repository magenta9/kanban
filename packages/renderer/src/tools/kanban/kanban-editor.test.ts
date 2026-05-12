import { describe, expect, it } from "vitest";
import { shouldSyncRichTextEditorContent } from "./kanban";

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
