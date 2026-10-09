import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PdfRendererStatus { available: boolean; edgeVersion?: string; message: string; }
export interface PdfRenderOptions { signal?: AbortSignal; }
export interface PdfRenderer { status(): PdfRendererStatus; render(url: string, options?: PdfRenderOptions): Promise<Buffer>; }
export type PdfRenderErrorCode = "pdf_cancelled" | "pdf_timeout" | "pdf_output_incomplete" | "pdf_edge_unavailable" | "pdf_engine_unavailable" | "pdf_render_failed";

export class PdfRenderError extends Error {
  constructor(public readonly code: PdfRenderErrorCode, message: string, public readonly retryable = false) { super(message); this.name = "PdfRenderError"; }
}

export function findEdgeExecutable(): string | undefined {
  const candidates = [
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : ""
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

export function validatePdfBuffer(buffer: Buffer): boolean {
  if (buffer.length < 500) return false;
  const header = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  const tail = buffer.subarray(Math.max(0, buffer.length - 64)).toString("ascii").includes("%%EOF");
  return header && tail;
}

async function waitForStablePdf(outputPath: string, signal: AbortSignal | undefined, deadline: number): Promise<Buffer> {
  let previousSize = -1; let stableReads = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new PdfRenderError("pdf_cancelled", "已取消 PDF 生成");
    try {
      const info = await stat(outputPath);
      if (info.size === previousSize && info.size > 0) stableReads += 1; else stableReads = 0;
      previousSize = info.size;
      if (stableReads >= 2) {
        const buffer = await readFile(outputPath);
        if (validatePdfBuffer(buffer)) return buffer;
      }
    } catch { /* Edge may still be writing the output file. */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
  }
  throw new PdfRenderError("pdf_output_incomplete", "Edge 未生成完整 PDF 文件，请重试", true);
}

function waitForChild(child: ReturnType<typeof spawn>, signal: AbortSignal | undefined, deadline: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback: () => void) => { if (finished) return; finished = true; callback(); };
    const stop = (error: PdfRenderError) => { child.kill(); finish(() => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(error); }); };
    const timer = setTimeout(() => stop(new PdfRenderError("pdf_timeout", "PDF 生成超时，请减少图片大小或稍后重试", true)), Math.max(1, deadline - Date.now()));
    const onAbort = () => stop(new PdfRenderError("pdf_cancelled", "已取消 PDF 生成"));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", () => finish(() => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(new PdfRenderError("pdf_render_failed", "Edge 进程无法启动")); }));
    child.once("close", (code) => finish(() => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(code); }));
  });
}

export class EdgePdfRenderer implements PdfRenderer {
  private readonly edgePath: string | undefined;
  constructor(edgePath = findEdgeExecutable()) { this.edgePath = edgePath; }
  status(): PdfRendererStatus {
    if (!this.edgePath) return { available: false, message: "未找到 Microsoft Edge，无法生成正式 PDF" };
    return { available: true, message: "Microsoft Edge PDF 渲染可用" };
  }
  async render(url: string, options: PdfRenderOptions = {}): Promise<Buffer> {
    if (!this.edgePath) throw new PdfRenderError("pdf_edge_unavailable", "未找到 Microsoft Edge；请安装或修复 Edge 后重试");
    try { new URL(url); } catch { throw new PdfRenderError("pdf_render_failed", "PDF 页面地址无效"); }
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const workDirectory = await mkdtemp(join(tmpdir(), "career-workbench-pdf-"));
      const outputPath = join(workDirectory, "resume.pdf"); const profilePath = join(workDirectory, "edge-profile");
      const deadline = Date.now() + 60_000;
      try {
        const child = spawn(this.edgePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--disable-sync", "--no-first-run", `--user-data-dir=${profilePath}`, `--print-to-pdf=${outputPath}`, "--print-to-pdf-no-header", "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw", url], { windowsHide: true, stdio: "ignore" });
        const exitCode = await waitForChild(child, options.signal, deadline);
        const buffer = await waitForStablePdf(outputPath, options.signal, Math.min(deadline + 5_000, Date.now() + 5_000));
        void exitCode;
        return buffer;
      } catch (error) {
        lastError = error;
        if (!(error instanceof PdfRenderError) || error.code !== "pdf_output_incomplete" || attempt === 1) throw error;
      } finally { await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined); }
    }
    throw lastError instanceof Error ? lastError : new PdfRenderError("pdf_render_failed", "PDF 生成失败");
  }
}
