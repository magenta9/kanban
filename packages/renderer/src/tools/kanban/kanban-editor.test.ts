import { describe, expect, it } from "vitest";
import { shouldSyncRichTextEditorContent } from "./kanban";

const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] };
const documentWithText = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }]
};

describe("shouldSyncRichTextEditorContent", () => {
    it("does not replace editor content while the user is focused in the editor", () => {
        expect(shouldSyncRichTextEditorContent(true, emptyDocument, documentWithText)).toBe(false);
    });

    it("syncs external content changes when the editor is not focused", () => {
        expect(shouldSyncRichTextEditorContent(false, emptyDocument, documentWithText)).toBe(true);
    });

    it("skips redundant external content syncs", () => {
        expect(shouldSyncRichTextEditorContent(false, emptyDocument, emptyDocument)).toBe(false);
    });
});
