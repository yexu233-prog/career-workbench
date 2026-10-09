const MAX_PDF_PAGES = 300;

/** The PDF.js display API needs the window context; PDF parsing runs in its own worker. */
export async function extractPdfText(bytes: Uint8Array, maxCharacters: number, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const [pdfjs, workerAsset] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")
  ]);
  signal?.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = workerAsset.default;
  const task = pdfjs.getDocument({
    data: bytes, disableFontFace: true, useWorkerFetch: false,
    cMapUrl: "/assets/pdfjs/cmaps/", cMapPacked: true,
    standardFontDataUrl: "/assets/pdfjs/standard_fonts/"
  });
  let destroyTask: Promise<void> | undefined;
  const destroy = () => destroyTask ??= task.destroy().catch(() => undefined);
  const abort = () => { void destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) throw new Error("PDF 超过 300 页，暂不支持解析");
    const pages: string[] = [];
    let total = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
      total += text.length + (pages.length ? 2 : 0);
      if (total > maxCharacters) throw new Error("提取文字超过 200,000 字符，请精简后再保存");
      pages.push(text);
      page.cleanup();
    }
    signal?.throwIfAborted();
    return pages.join("\n\n");
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === "PasswordException") throw new Error("该 PDF 受密码保护，请先在本机解锁文件，再重新导入。");
    if (error instanceof Error && error.name === "InvalidPDFException") throw new Error("PDF 文件损坏或格式无效，请重新导出一份 PDF 后再导入。");
    throw error instanceof Error && /[\u3400-\u9fff]/u.test(error.message) ? error : new Error("PDF 文字提取失败，请确认文件能正常打开，或改用 DOCX、TXT 格式导入。");
  } finally {
    signal?.removeEventListener("abort", abort);
    await destroy();
  }
}
