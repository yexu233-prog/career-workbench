import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright-core";
import { MacChromiumPdfRenderer } from "./mac-chromium-renderer.js";

const url = "http://127.0.0.1:41823/api/pdf/document/test-123";
function validPdf() { return Buffer.from("%PDF-1.7\n" + "x".repeat(600) + "\n%%EOF"); }
function fakeBrowser(output = validPdf()) {
  const page = { setDefaultTimeout: vi.fn(), goto: vi.fn().mockResolvedValue(undefined), emulateMedia: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue(undefined), pdf: vi.fn().mockResolvedValue(output) };
  const close = vi.fn().mockResolvedValue(undefined);
  return { page, close, browser: { newPage: vi.fn().mockResolvedValue(page), close } as unknown as Browser };
}
describe("Mac package PDF controller", () => {
  it("does not search or download an engine when absent", async () => {
    const launch = vi.fn(); const renderer = new MacChromiumPdfRenderer(undefined, launch);
    expect(renderer.status().available).toBe(false);
    await expect(renderer.render(url)).rejects.toMatchObject({ code: "pdf_engine_unavailable" });
    expect(launch).not.toHaveBeenCalled();
  });
  it.each(["https://example.com/", "http://127.0.0.1:41823/", url + "?secret=1", "http://localhost:41823/api/pdf/document/test-123"])("rejects non-document address %s", async (address) => {
    await expect(new MacChromiumPdfRenderer(process.execPath).render(address)).rejects.toMatchObject({ code: "pdf_render_failed" });
  });
  it("prints A4, waits for fonts and closes the isolated browser", async () => {
    const fake = fakeBrowser(); const launch = vi.fn().mockResolvedValue(fake.browser);
    const result = await new MacChromiumPdfRenderer(process.execPath, launch).render(url);
    expect(result).toEqual(validPdf()); expect(fake.page.evaluate).toHaveBeenCalled();
    expect(fake.page.pdf).toHaveBeenCalledWith({ format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(launch.mock.calls[0]?.[0]).toMatchObject({ executablePath: process.execPath, headless: true });
    expect(fake.close).toHaveBeenCalledTimes(1);
  });
  it("retries only incomplete output with a new browser", async () => {
    const first = fakeBrowser(Buffer.from("empty")); const second = fakeBrowser();
    const launch = vi.fn().mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    await new MacChromiumPdfRenderer(process.execPath, launch).render(url);
    expect(launch).toHaveBeenCalledTimes(2); expect(first.close).toHaveBeenCalledOnce(); expect(second.close).toHaveBeenCalledOnce();
  });
  it("drains a late launch after cancellation without printing", async () => {
    const fake = fakeBrowser(); const controller = new AbortController();
    const launch = vi.fn().mockImplementation(async () => { controller.abort(); return fake.browser; });
    await expect(new MacChromiumPdfRenderer(process.execPath, launch).render(url, { signal: controller.signal })).rejects.toMatchObject({ code: "pdf_cancelled" });
    expect(fake.close).toHaveBeenCalledOnce(); expect(fake.page.pdf).not.toHaveBeenCalled(); expect(launch).toHaveBeenCalledOnce();
  });
  it("times out without retry and redacts engine errors", async () => {
    const fake = fakeBrowser();
    const launch = vi.fn().mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return fake.browser; });
    await expect(new MacChromiumPdfRenderer(process.execPath, launch, 5).render(url)).rejects.toMatchObject({ code: "pdf_timeout" });
    expect(fake.close).toHaveBeenCalledOnce(); expect(launch).toHaveBeenCalledOnce();
    await expect(new MacChromiumPdfRenderer(process.execPath, async () => { throw new Error("private-path-and-content"); }).render(url)).rejects.not.toThrow("private-path-and-content");
  });
});
