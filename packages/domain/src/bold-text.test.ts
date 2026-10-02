import { describe, expect, it } from "vitest";
import { parseBoldText, stripBoldMarkup, toggleBoldMarkup } from "./index";

describe("bold text helpers", () => {
  it("parses only balanced bold markers", () => {
    expect(parseBoldText("负责 **需求分析** 与交付")).toEqual([
      { text: "负责 ", bold: false },
      { text: "需求分析", bold: true },
      { text: " 与交付", bold: false }
    ]);
    expect(parseBoldText("未完成 **标记")).toEqual([{ text: "未完成 **标记", bold: false }]);
  });

  it("strips valid markers without swallowing literal asterisks", () => {
    expect(stripBoldMarkup("完成 **3 个项目**")).toBe("完成 3 个项目");
    expect(stripBoldMarkup("保留 **未闭合")).toBe("保留 **未闭合");
  });

  it("adds and removes bold around the selected text", () => {
    const added = toggleBoldMarkup("负责需求分析", 2, 6);
    expect(added).toEqual({ value: "负责**需求分析**", selectionStart: 4, selectionEnd: 8 });
    expect(toggleBoldMarkup(added.value, added.selectionStart, added.selectionEnd)).toEqual({ value: "负责需求分析", selectionStart: 2, selectionEnd: 6 });
    expect(toggleBoldMarkup("负责需求分析", 2, 2).value).toBe("负责需求分析");
  });
});
