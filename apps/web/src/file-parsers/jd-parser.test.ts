import { describe, expect, it, vi } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { MAX_JD_FILE_SIZE, normalizeJdText, parseJdFileDirect } from "./jd-parser";

// Vitest loads Mammoth's Node entry; adapt only its input transport.
// Real ZIP/XML extraction still runs against the patched installed parser.
vi.mock("mammoth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mammoth")>();
  return {
    ...actual,
    extractRawText: (options: { arrayBuffer: ArrayBuffer }) => actual.extractRawText({ buffer: Buffer.from(options.arrayBuffer) })
  };
});

describe("JD text normalization", () => {
  it("imports a real synthetic DOCX after XML parser security updates", async () => {
    const document = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun("虚构经历：示例公司"), new TextRun({ text: " 产品经理", bold: true })] }),
      new Paragraph("仅测试导入；推动需求交付与结果复盘。")
    ] }] });
    const blob = await Packer.toBlob(document);
    const file = new File([await blob.arrayBuffer()], "synthetic-resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const result = await parseJdFileDirect(file);
    expect(result.sourceType).toBe("docx");
    expect(result.text).toContain("虚构经历：示例公司 产品经理");
    expect(result.text).toContain("推动需求交付与结果复盘");
  });
  it("normalizes line endings and control characters without truncating text", () => {
    expect(normalizeJdText("岗位\r\n\u0000要求\r\n\r\n\r\n\r\n能力  \r\n")).toBe("岗位\n要求\n\n\n能力");
  });

  it("rejects an oversized file before reading its bytes", async () => {
    let read = false;
    const file = { name: "jd.txt", type: "text/plain", size: MAX_JD_FILE_SIZE + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } } as File;
    await expect(parseJdFileDirect(file)).rejects.toThrow("10MB");
    expect(read).toBe(false);
  });

  it("extracts a UTF-8 TXT resume without changing its content", async () => {
    const file = new File(["工作经历\r\n示例公司 产品经理\r\n推动需求交付"], "resume.txt", { type: "text/plain" });
    const result = await parseJdFileDirect(file);
    expect(result).toMatchObject({ sourceName: "resume.txt", sourceType: "txt", warnings: [] });
    expect(result.text).toBe("工作经历\n示例公司 产品经理\n推动需求交付");
  });
});
