import { describe, expect, it } from "vitest";
import { isEditableShortcutTarget, keyboardShortcutFromEvent } from "./kanban-helpers";

function shortcutEvent(input: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">): Pick<KeyboardEvent, "key" | "metaKey" | "shiftKey" | "altKey"> {
    return {
        key: input.key,
        metaKey: input.metaKey ?? false,
        shiftKey: input.shiftKey ?? false,
        altKey: input.altKey ?? false
    };
}

describe("keyboardShortcutFromEvent", () => {
    it("opens help with Cmd+/ even from editable targets", () => {
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "/", metaKey: true }), true)).toEqual({ type: "openHelp" });
    });

    it("closes with Escape even from editable targets", () => {
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "Escape" }), true)).toEqual({ type: "close" });
    });

    it("selects boards with Cmd+1 through Cmd+9", () => {
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "1", metaKey: true }), false)).toEqual({ type: "selectBoardByIndex", index: 0 });
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "9", metaKey: true }), false)).toEqual({ type: "selectBoardByIndex", index: 8 });
    });

    it("maps creation and layout shortcuts", () => {
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "b", metaKey: true }), false)).toEqual({ type: "toggleBoardList" });
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "n", metaKey: true }), false)).toEqual({ type: "createCard" });
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "n", metaKey: true, shiftKey: true }), false)).toEqual({ type: "createColumn" });
    });

    it("maps view switching shortcuts", () => {
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "k", metaKey: true }), false)).toEqual({ type: "setView", view: "kanban" });
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "l", metaKey: true }), false)).toEqual({ type: "setView", view: "list" });
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "a", metaKey: true }), false)).toEqual({ type: "setView", view: "archive" });
    });

    it("blocks non-help shortcuts from editable targets", () => {
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "n", metaKey: true }), true)).toBeNull();
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "1", metaKey: true }), true)).toBeNull();
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "b", metaKey: true }), true)).toBeNull();
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "a", metaKey: true }), true)).toBeNull();
    });

    it("ignores shortcuts with Alt", () => {
        expect(keyboardShortcutFromEvent(shortcutEvent({ key: "n", metaKey: true, altKey: true }), false)).toBeNull();
    });
});

describe("isEditableShortcutTarget", () => {
    it("detects form controls", () => {
        const input = document.createElement("input");
        const textarea = document.createElement("textarea");
        const select = document.createElement("select");

        expect(isEditableShortcutTarget(input)).toBe(true);
        expect(isEditableShortcutTarget(textarea)).toBe(true);
        expect(isEditableShortcutTarget(select)).toBe(true);
    });

    it("detects contenteditable ancestors", () => {
        const editor = document.createElement("div");
        const child = document.createElement("span");
        editor.contentEditable = "true";
        editor.append(child);

        expect(isEditableShortcutTarget(child)).toBe(true);
    });

    it("ignores ordinary elements", () => {
        expect(isEditableShortcutTarget(document.createElement("button"))).toBe(false);
        expect(isEditableShortcutTarget(null)).toBe(false);
    });
});
