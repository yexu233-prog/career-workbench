import http from "node:http";
import { readFile } from "node:fs/promises";
import { EdgePdfRenderer } from "../apps/local-service/dist/pdf/edge-renderer.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const renderer = new EdgePdfRenderer();
if (!renderer.status().available) throw new Error(renderer.status().message);
const fontData = (await readFile(new URL("../assets/fonts/NotoSansCJKsc-Regular.otf", import.meta.url))).toString("base64");
const cases = [
  { name: "one-page-cn", pages: 1, photo: false, marker: "CASE_ONE", text: "虚构中文简历 一页测试" },
  { name: "two-page-mixed", pages: 2, photo: false, marker: "CASE_TWO", text: "Mixed English 中文 Page" },
  { name: "three-page-long", pages: 3, photo: false, marker: "CASE_THREE", text: "长姓名 long.email@example.test https://example.test" },
  { name: "photo-visible", pages: 1, photo: true, marker: "CASE_PHOTO", text: "含虚构照片占位" },
  { name: "photo-hidden", pages: 1, photo: false, marker: "CASE_HIDDEN", text: "隐藏照片不影响布局" },
  { name: "long-bullets", pages: 2, photo: false, marker: "CASE_LONG", text: "要点 ".repeat(120) }
];
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/Sc7u2QAAAABJRU5ErkJggg==";
const server = http.createServer((request, response) => {
  const index = Number(new URL(request.url, "http://127.0.0.1").searchParams.get("case") ?? 0);
  const item = cases[index] ?? cases[0];
  const pages = Array.from({ length: item.pages }, (_, page) => `<section class="resume-page"><h1>${item.text}</h1>${page === 0 && item.photo ? `<img alt="photo" src="${png}" />` : ""}<p>${item.text}</p>${page === 0 ? `<span>${item.marker}</span>` : ""}</section>`).join("");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><meta charset="utf-8"><style>@font-face{font-family:TestCJK;src:url(data:font/otf;base64,${fontData})}@page{size:A4;margin:0}html,body{margin:0}.resume-pages{width:210mm}.resume-page{box-sizing:border-box;width:210mm;height:297mm;padding:18mm;font-family:TestCJK,Arial,sans-serif;break-after:page;overflow:hidden}.resume-page:last-child{break-after:auto}img{width:24mm;height:24mm;object-fit:cover;float:right}</style><main class="resume-pages">${pages}</main>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
try {
  for (const [index, item] of cases.entries()) {
    const pdf = await renderer.render(`${baseUrl}/?case=${index}`);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) || !pdf.subarray(-64).includes(Buffer.from("%%EOF"))) throw new Error(`${item.name}: PDF 标记无效`);
    const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true }).promise;
    if (document.numPages !== item.pages) throw new Error(`${item.name}: 页数 ${document.numPages}，预期 ${item.pages}`);
    const page = await document.getPage(1); const viewport = page.getViewport({ scale: 1 });
    if (Math.abs(viewport.width - 595.28) > 2 || Math.abs(viewport.height - 841.89) > 2) throw new Error(`${item.name}: 页面不是 A4`);
    const text = (await page.getTextContent()).items.map((entry) => "str" in entry ? entry.str : "").join(" ");
    if (!text.includes(item.marker)) throw new Error(`${item.name}: 关键文字不可提取`);
    console.log(`${item.name}: OK (${document.numPages} pages, ${pdf.length} bytes)`);
  }
} finally { server.close(); }
