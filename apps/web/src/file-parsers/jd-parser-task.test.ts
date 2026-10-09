import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseJdFile } from "./jd-parser";
import { extractPdfText } from "./pdf-text";
vi.mock("./pdf-text", () => ({ extractPdfText: vi.fn() }));
const extract = vi.mocked(extractPdfText);
const workers: { terminate: ReturnType<typeof vi.fn> }[] = [];
const pdf = () => new File(["%PDF-1.7 fictional"], "fictional.pdf", { type: "application/pdf" });
beforeEach(() => {
  extract.mockReset(); workers.length = 0;
  vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  vi.stubGlobal("Worker", class {
    terminate = vi.fn(); postMessage() {}
    constructor() { workers.push(this); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("file parse routing and cancellation", () => {
  it("runs PDF orchestration outside the application worker and retains file metadata", async () => {
    extract.mockResolvedValue("虚构经历");
    await expect(parseJdFile(pdf()).promise).resolves.toMatchObject({ text: "虚构经历", sourceType: "pdf", sourceName: "fictional.pdf" });
    expect(workers).toHaveLength(0);
  });
  it("settles PDF cancellation promptly and forwards an abort to the PDF task", async () => {
    extract.mockImplementation((_bytes, _max, signal) => new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })));
    const task = parseJdFile(pdf()); const rejected = expect(task.promise).rejects.toThrow("已取消");
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    task.cancel(); await rejected;
    expect(extract.mock.calls[0]![2]!.aborted).toBe(true);
  });
  it("times out PDF processing and aborts the pending extraction", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    extract.mockImplementation((_bytes, _max, signal) => new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })));
    const task = parseJdFile(pdf()); const rejected = expect(task.promise).rejects.toThrow("超时");
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(60000); await rejected;
    expect(extract.mock.calls[0]![2]!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("terminates a cancelled TXT/DOCX worker and settles its promise only once", async () => {
    vi.useFakeTimers(); vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
    const task = parseJdFile(new File(["fictional text"], "fictional.txt"));
    const rejected = expect(task.promise).rejects.toThrow("已取消");
    task.cancel(); task.cancel(); await rejected;
    expect(workers).toHaveLength(1); expect(workers[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
