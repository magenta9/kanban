import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./markdown";

describe("markdownToPlainText", () => {
  it("derives a compact text summary from Markdown", () => {
    expect(markdownToPlainText("## Scope\n\n- Ship [notes](https://example.com)\n- `code`"))
      .toBe("Scope\nShip notes\ncode");
  });

  it("returns undefined for empty Markdown", () => {
    expect(markdownToPlainText("   ")).toBeUndefined();
    expect(markdownToPlainText(undefined)).toBeUndefined();
  });
});