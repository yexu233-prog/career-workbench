import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractPdfText } from "./pdf-text";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({ default: "/assets/fictional-worker.mjs" }));
const load = vi.mocked(getDocument);
const bytes = () => new Uint8Array([37, 80, 68, 70]);
function install(pages: string[], count = pages.length) {
  const cleanups = pages.map(() => vi.fn());
  const getPage = vi.fn(async (page: number) => ({
    getTextContent: async () => ({ items: [{ str: pages[page - 1], hasEOL: true }] }), cleanup: cleanups[page - 1]
  }));
  const destroy = vi.fn(async () => {});
  load.mockImplementation(() => ({ promise: Promise.resolve({ numPages: count, getPage }), destroy }) as unknown as ReturnType<typeof getDocument>);
  return { getPage, destroy, cleanups };
}
beforeEach(() => { load.mockReset(); });
describe("PDF text lifecycle", () => {
  it("preserves Chinese and page order, cleans pages and destroys the owned task", async () => {
    const task = install(["第一页 学校", "Second page 公司"]);
    expect(await extractPdfText(bytes(), 200000)).toBe("第一页 学校\n\nSecond page 公司");
    expect(task.destroy).toHaveBeenCalledTimes(1);
    task.cleanups.forEach(cleanup => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ cMapUrl: "/assets/pdfjs/cmaps/", standardFontDataUrl: "/assets/pdfjs/standard_fonts/" }));
  });
  it("rejects excess pages before extracting and rejects text overflow without returning a partial result", async () => {
    const excessive = install([], 301);
    await expect(extractPdfText(bytes(), 200000)).rejects.toThrow("300 页");
    expect(excessive.getPage).not.toHaveBeenCalled(); expect(excessive.destroy).toHaveBeenCalledTimes(1);
    const text = install(["long text"]);
    await expect(extractPdfText(bytes(), 2)).rejects.toThrow("超过");
    expect(text.destroy).toHaveBeenCalledTimes(1);
  });
  it("maps password and damaged-file failures into understandable messages and still destroys resources", async () => {
    for (const [name, message] of [["PasswordException", "密码保护"], ["InvalidPDFException", "损坏"]]) {
      const destroy = vi.fn(async () => {});
      load.mockImplementation(() => ({ promise: Promise.reject(Object.assign(new Error("fictional internal error"), { name })), destroy }) as unknown as ReturnType<typeof getDocument>);
      await expect(extractPdfText(bytes(), 200000)).rejects.toThrow(message);
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  });
  it("cancels a pending load, destroys exactly once, and rejects an already-cancelled request before creating a task", async () => {
    let rejectLoad!: (error: Error) => void;
    const destroy = vi.fn(async () => { rejectLoad(new Error("destroyed")); });
    load.mockImplementation(() => ({ promise: new Promise((_resolve, reject) => { rejectLoad = reject; }), destroy }) as unknown as ReturnType<typeof getDocument>);
    const controller = new AbortController();
    const pending = extractPdfText(bytes(), 200000, controller.signal);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("cancelled", "AbortError"));
    await rejected; expect(destroy).toHaveBeenCalledTimes(1);
    load.mockClear();
    await expect(extractPdfText(bytes(), 200000, controller.signal)).rejects.toThrow("cancelled");
    expect(load).not.toHaveBeenCalled();
  });
});
