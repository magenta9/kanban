import { describe, expect, it } from "vitest";
import { isAgentRunComment } from "./kanban";

describe("isAgentRunComment", () => {
    it("matches Agent Run lifecycle comments", () => {
        expect(isAgentRunComment({ body: "Agent run started." })).toBe(true);
        expect(isAgentRunComment({ body: "Agent run completed." })).toBe(true);
        expect(isAgentRunComment({ body: "Agent run failed." })).toBe(true);
        expect(isAgentRunComment({ body: "Agent run finished." })).toBe(true);
    });

    it("does not match ordinary comments", () => {
        expect(isAgentRunComment({ body: "External note" })).toBe(false);
        expect(isAgentRunComment({ body: "Agent should run later." })).toBe(false);
    });
});
