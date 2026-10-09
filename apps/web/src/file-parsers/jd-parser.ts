export const MAX_JD_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_JD_TEXT_LENGTH = 200_000;
export const LONG_JD_WARNING_LENGTH = 50_000;

export type JdFileKind = "txt" | "docx" | "pdf";

export interface JdParseResult {
  text: string;
  sourceName: string;
  sourceType: JdFileKind;
  warnings: string[];
  parsedAt: string;
}

export function normalizeJdText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function extensionOf(name: string): string {
  const match = name.toLocaleLowerCase().match(/\.([^.]+)$/);
  return match?.[1] ?? "";
}

function verifyFile(file: File, bytes: Uint8Array): JdFileKind {
  const extension = extensionOf(file.name);
  const genericTypes = new Set(["", "application/octet-stream"]);
  if (extension === "txt") {
    if (!genericTypes.has(file.type) && file.type !== "text/plain") throw new Error("文件扩展名与内容类型不一致");
    return "txt";
  }
  if (extension === "docx") {
    if (!genericTypes.has(file.type) && file.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") throw new Error("文件扩展名与内容类型不一致");
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("文件内容不是有效的 DOCX 文档");
    return "docx";
  }
  if (extension === "pdf") {
    if (!genericTypes.has(file.type) && file.type !== "application/pdf") throw new Error("文件扩展名与内容类型不一致");
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("文件内容不是有效的 PDF 文档");
    return "pdf";
  }
  throw new Error("仅支持 TXT、DOCX 和带文字层的 PDF 文件");
}

function verifyDocxArchive(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let index = Math.max(0, bytes.length - 65_557); index <= bytes.length - 22; index += 1) if (view.getUint32(index, true) === 0x06054b50) endOffset = index;
  if (endOffset < 0) throw new Error("DOCX 压缩目录损坏");
  const entries = view.getUint16(endOffset + 10, true);
  if (entries > 2_000) throw new Error("DOCX 内部文件过多，已停止解析");
  let offset = view.getUint32(endOffset + 16, true);
  let totalUncompressed = 0;
  let hasDocument = false;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error("DOCX 压缩目录无效");
    if ((view.getUint16(offset + 8, true) & 1) !== 0) throw new Error("不支持加密或密码保护的 DOCX");
    totalUncompressed += view.getUint32(offset + 24, true);
    if (totalUncompressed > 100 * 1024 * 1024) throw new Error("DOCX 解压后内容过大，已停止解析");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    if (name === "word/document.xml") hasDocument = true;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!hasDocument) throw new Error("文件不是有效的 DOCX 文档");
}

function decodeText(bytes: Uint8Array): { text: string; warning?: string } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes) };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = bytes.slice(2);
    for (let index = 0; index + 1 < swapped.length; index += 2) [swapped[index], swapped[index + 1]] = [swapped[index + 1]!, swapped[index]!];
    return { text: new TextDecoder("utf-16le").decode(swapped) };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { text: new TextDecoder("gb18030").decode(bytes), warning: "文件不是 UTF-8 编码，已尝试按 GB18030 解码，请检查中文是否正确。" };
  }
}

export async function parseJdFileDirect(file: File, signal?: AbortSignal): Promise<JdParseResult> {
  signal?.throwIfAborted();
  if (file.size > MAX_JD_FILE_SIZE) throw new Error("JD 文件不能超过 10MB");
  if (!file.size) throw new Error("JD 文件为空");
  const buffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  const bytes = new Uint8Array(buffer);
  const sourceType = verifyFile(file, bytes);
  const warnings: string[] = [];
  let text = "";

  if (sourceType === "txt") {
    const decoded = decodeText(bytes);
    text = decoded.text;
    if (decoded.warning) warnings.push(decoded.warning);
  } else if (sourceType === "docx") {
    verifyDocxArchive(bytes);
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    text = result.value;
    warnings.push(...result.messages.map((message: { message: string }) => `DOCX：${message.message}`));
  } else {
    const { extractPdfText } = await import("./pdf-text");
    text = await extractPdfText(bytes, MAX_JD_TEXT_LENGTH, signal);
    warnings.push("PDF 多栏、页眉或表格的文字顺序可能与原文件不同，请核对后再保存。");
  }

  text = normalizeJdText(text);
  if (!text) throw new Error(sourceType === "pdf" ? "未提取到文字；该 PDF 可能是扫描件，本测试版不支持 OCR。" : "未提取到可用文字");
  if (text.length > MAX_JD_TEXT_LENGTH) throw new Error("提取文字超过 200,000 字符，请精简后再保存");
  if (text.length > LONG_JD_WARNING_LENGTH) warnings.push("JD 超过 50,000 字符，内容异常偏长，请确认是否选错文件。");
  return { text, sourceName: file.name, sourceType, warnings, parsedAt: new Date().toISOString() };
}

export function parseJdFile(file: File): { promise: Promise<JdParseResult>; cancel: () => void } {
  // PDF.js itself creates a worker. Running its display API inside our worker
  // triggers its fallback and leaks its "ready" protocol into our result channel.
  if (extensionOf(file.name) === "pdf") {
    const controller = new AbortController();
    let timer: number;
    const promise = new Promise<JdParseResult>((resolve, reject) => {
      timer = window.setTimeout(() => controller.abort(new Error("文件解析超时，请改为粘贴文字")), 60_000);
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      void parseJdFileDirect(file, controller.signal).then(resolve, reject).finally(() => window.clearTimeout(timer));
    });
    return { promise, cancel: () => { window.clearTimeout(timer); controller.abort(new DOMException("文件解析已取消", "AbortError")); } };
  }
  const worker = new Worker(new URL("./jd-parser.worker.ts", import.meta.url), { type: "module" });
  let cancel = () => {};
  const promise = new Promise<JdParseResult>((resolve, reject) => {
    let settled = false;
    const finish = (result?: JdParseResult, error?: Error) => {
      if (settled) return;
      settled = true; window.clearTimeout(timeout); worker.terminate();
      if (error) reject(error); else if (result) resolve(result); else reject(new Error("文件解析返回了无效结果"));
    };
    const timeout = window.setTimeout(() => finish(undefined, new Error("文件解析超时，请改为粘贴文字")), 60_000);
    cancel = () => finish(undefined, new DOMException("文件解析已取消", "AbortError"));
    worker.onmessage = (event: MessageEvent<{ result?: JdParseResult; error?: string }>) => {
      finish(event.data.result, event.data.error ? new Error(event.data.error) : undefined);
    };
    worker.onerror = () => finish(undefined, new Error("文件解析失败，请改为粘贴文字"));
    worker.postMessage(file);
  });
  return { promise, cancel: () => cancel() };
}
