import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Browser, LaunchOptions } from "playwright-core";
import { PdfRenderError, validatePdfBuffer, type PdfRenderer, type PdfRenderOptions, type PdfRendererStatus } from "./edge-renderer.js";

export type ChromiumLauncher = (options: LaunchOptions) => Promise<Browser>;

/** Only uses the supplied package engine; never downloads or searches user browsers. */
export class MacChromiumPdfRenderer implements PdfRenderer {
  constructor(private readonly executablePath?: string, private readonly launcher?: ChromiumLauncher, private readonly timeoutMs = 60_000) {}
  status(): PdfRendererStatus {
    const available = Boolean(this.executablePath && isAbsolute(this.executablePath) && existsSync(this.executablePath));
    return { available, message: available ? "随包 Chromium PDF 引擎已找到" : "Mac PDF 组件未就绪，请使用包含 Chromium 的完整测试包" };
  }
  async render(url: string, options: PdfRenderOptions = {}): Promise<Buffer> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new PdfRenderError("pdf_render_failed", "PDF 页面地址无效"); }
    if (parsed.origin !== "http://127.0.0.1:41823" || !/^\/api\/pdf\/document\/[A-Za-z0-9-]+$/.test(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password) throw new PdfRenderError("pdf_render_failed", "PDF 仅允许读取本机简历页面");
    if (options.signal?.aborted) throw new PdfRenderError("pdf_cancelled", "已取消 PDF 生成");
    if (!this.status().available) throw new PdfRenderError("pdf_engine_unavailable", "Mac PDF 组件未就绪，请重新获取完整测试包");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await this.attempt(url, options); }
      catch (error) { if (!(error instanceof PdfRenderError) || error.code !== "pdf_output_incomplete" || attempt === 1) throw error; }
    }
    throw new PdfRenderError("pdf_render_failed", "PDF 生成失败");
  }
  private async attempt(url: string, options: PdfRenderOptions): Promise<Buffer> {
    let browser: Browser | undefined;
    let closeTask: Promise<void> | undefined;
    let stopped: "pdf_cancelled" | "pdf_timeout" | undefined;
    const close = () => { if (browser && !closeTask) closeTask = browser.close().catch(() => undefined); return closeTask; };
    const stop = (code: "pdf_cancelled" | "pdf_timeout") => { stopped ??= code; void close(); };
    const abort = () => stop("pdf_cancelled");
    const timer = setTimeout(() => stop("pdf_timeout"), this.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    const check = () => {
      if (options.signal?.aborted) stopped ??= "pdf_cancelled";
      if (stopped) throw new PdfRenderError(stopped, stopped === "pdf_cancelled" ? "已取消 PDF 生成" : "PDF 生成超时，请稍后重试");
    };
    try {
      check();
      const launch = this.launcher ?? ((settings: LaunchOptions) => import("playwright-core").then(({ chromium }) => chromium.launch(settings)));
      browser = await launch({ ...(this.executablePath ? { executablePath: this.executablePath } : {}), headless: true, timeout: this.timeoutMs });
      check();
      const page = await browser.newPage();
      page.setDefaultTimeout(this.timeoutMs);
      await page.goto(url, { waitUntil: "load", timeout: this.timeoutMs });
      check();
      await page.emulateMedia({ media: "print" });
      await page.evaluate(async () => { await document.fonts.ready; });
      check();
      const result = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      check();
      if (!validatePdfBuffer(result)) throw new PdfRenderError("pdf_output_incomplete", "PDF 输出不完整，请重试", true);
      return result;
    } catch (error) {
      check();
      if (error instanceof PdfRenderError) throw error;
      if (error instanceof Error && error.name === "TimeoutError") throw new PdfRenderError("pdf_timeout", "PDF 生成超时，请稍后重试");
      throw new PdfRenderError("pdf_render_failed", "Mac PDF 引擎启动或生成失败，请检查测试包是否完整");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      await close();
    }
  }
}
