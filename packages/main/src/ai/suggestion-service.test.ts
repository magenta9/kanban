import { describe, expect, it } from "vitest";
import { isSuggestionWithinLimit, normalizeLabelName, normalizeLabelSuggestions, normalizeSuggestion } from "./suggestion-service";

describe("AI text suggestion normalization", () => {
    it("accepts non-empty suggestions within the character limit", () => {
        expect(isSuggestionWithinLimit("补全标题", 15)).toBe(true);
        expect(isSuggestionWithinLimit("", 15)).toBe(false);
        expect(isSuggestionWithinLimit("这是一段超过限制的补全文本", 5)).toBe(false);
    });

    it("strips fenced text wrappers", () => {
        expect(normalizeSuggestion("```markdown\n- Finish review\n```")).toBe("- Finish review");
    });

    it("strips model reasoning blocks before enforcing completion limits", () => {
        expect(normalizeSuggestion("<think>Analyze the card first.</think>\n补充验收标准")).toBe("补充验收标准");
    });
});

describe("AI label suggestion normalization", () => {
    const boardLabels = [
        { id: "label-1", name: "Frontend" },
        { id: "label-2", name: "Bug" }
    ];

    it("deduplicates labels and reuses existing unattached labels", () => {
        expect(normalizeLabelSuggestions('[" frontend ", "New", "new", "Bug"]', 5, boardLabels, ["label-2"])).toEqual([
            { name: "frontend", existingLabelId: "label-1" },
            { name: "New" }
        ]);
    });

    it("parses JSON labels after model reasoning blocks", () => {
        expect(normalizeLabelSuggestions('<think>Review the current card.</think>\n["Review", "Ops"]', 5, boardLabels, [])).toEqual([
            { name: "Review" },
            { name: "Ops" }
        ]);
    });

    it("does not turn prose or reasoning into labels", () => {
        expect(normalizeLabelSuggestions('<think>Let me analyze this card.</think> Priority: high, no labels assigned', 5, boardLabels, [])).toEqual([]);
    });

    it("normalizes label names case-insensitively", () => {
        expect(normalizeLabelName("  Product   Ops ")).toBe("product ops");
    });
});