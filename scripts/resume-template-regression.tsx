import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildResumeDocumentModel, DEFAULT_RESUME_STYLE, type ResumeProject } from "@career-workbench/domain";
import { ResumePreview } from "../apps/web/src/components/ResumePreview";
import { EdgePdfRenderer } from "../apps/local-service/dist/pdf/edge-renderer.js";

const root = process.cwd();
const outputDirectory = resolve(root, "tmp/pdfs");
const outputPath = resolve(outputDirectory, "resume-template-v2-synthetic.pdf");
const css = await readFile(resolve(root, "apps/web/src/resume-document.css"), "utf8");
const font = await readFile(resolve(root, "assets/fonts/NotoSansCJKsc-Regular.otf"));
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/Sc7u2QAAAABJRU5ErkJggg==";
const timestamp = "2026-09-28T00:00:00.000Z";
const entry = (id: string, category: "education" | "work", current: ResumeProject["modules"][number]["entries"][number]["current"]) => ({
  id, sourceMaterialItemId: `material-${id}`, sourceVersionId: `version-${id}`, sourceMaterialName: current.heading,
  sourceVersionName: "合成回归版本", sourceCategory: category, sourceVersionRevision: 1, lastSynced: { ...current }, current: { ...current }
});
const project: ResumeProject = {
  id: "synthetic-template-regression", schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1,
  name: "合成版式回归", targetRole: "产品经理", language: "zh-CN", targetLength: "one",
  jdText: "", jdOriginalText: "", jdSourceName: "",
  profile: {
    chineseName: "林杉（样例）", englishName: "Lin Shan", phone: "13800000000", email: "sample@example.test", city: "杭州",
    targetDirection: "产品经理", summary: "以用户需求和业务结果为导向，推进产品从问题识别到方案落地。",
    skills: ["用户研究", "需求分析", "SQL"], links: [], customFields: [], hiddenFields: [],
    photo: { name: "synthetic.png", mimeType: "image/png", data: new Blob(["synthetic photo"]) }
  },
  modules: [
    { id: "education", title: "教育经历", kind: "material", category: "education", hidden: false, text: "", pageBreakBefore: false, entries: [entry("education-entry", "education", { heading: "社会学", organization: "示例大学", role: "硕士 · 社会学", period: "2023—2026", location: "杭州", summary: "", bullets: [], links: [] })] },
    { id: "experience", title: "工作经历", kind: "material", category: "work", hidden: false, text: "", pageBreakBefore: false, entries: [entry("work-entry", "work", { heading: "产品实践", organization: "示例机构", role: "产品助理", period: "2025—2026", location: "杭州", summary: "梳理用户反馈并推动功能优化。", bullets: ["建立问题分级机制，提升处理效率。"], links: [] })] }
  ],
  style: { ...DEFAULT_RESUME_STYLE }
};

const model = buildResumeDocumentModel(project);
const markup = renderToStaticMarkup(createElement(ResumePreview, { model, photoUrlOverride: image }));
const renderer = new EdgePdfRenderer();
if (!renderer.status().available) throw new Error(renderer.status().message);

const server = createServer((request, response) => {
  if (request.url === "/api/pdf/font") {
    response.writeHead(200, { "content-type": "font/otf", "content-length": font.length });
    response.end(font);
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${markup}</body></html>`);
});

await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/`;
try {
  const pdf = await renderer.render(url);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, pdf);
  const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true }).promise;
  const page = await document.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  if (document.numPages !== model.pages.length) throw new Error(`PDF 页数 ${document.numPages} 与版面模型 ${model.pages.length} 不同`);
  if (Math.abs(viewport.width - 595.28) > 2 || Math.abs(viewport.height - 841.89) > 2) throw new Error("导出页面不是 A4");
  const text = (await page.getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ");
  const sequence = ["13800000000", "sample@example.test", "杭州", "求职意向", "产品经理", "示例大学", "社会学", "硕士", "示例机构", "产品助理", "产品实践", "专业技能", "用户研究"];
  let previous = -1;
  for (const value of sequence) {
    const next = text.indexOf(value);
    if (next < 0 || next <= previous) throw new Error(`缺少或顺序错误的模板字段：${value}`);
    previous = next;
  }
  console.log(`template-v2-synthetic: OK (${document.numPages} page, A4, header and entry order verified, ${pdf.length} bytes)`);
  console.log(`PDF visual QA file: ${outputPath}`);
} finally {
  server.close();
}
