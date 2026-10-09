// Exercises the production web bundle in an isolated browser with fictional files.
import { createServer } from "node:http";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { chromium } from "playwright-core";

const root = process.cwd();
const webRoot = resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) || "apps/web/dist");
const baseline = process.argv.includes("--baseline");
const output = resolve("tmp/pdf-import-regression");
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".bcmap": "application/octet-stream" };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (pathname.startsWith("/api/")) { res.writeHead(503, { "content-type": "application/json" }); res.end('{"message":"隔离测试未配置AI"}'); return; }
    const path = resolve(webRoot, "." + pathname);
    if (path !== webRoot && !path.startsWith(webRoot + sep)) { res.writeHead(403); res.end(); return; }
    const file = await stat(path).then(info => info.isFile() ? path : join(webRoot, "index.html")).catch(() => join(webRoot, "index.html"));
    const data = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolveTask => server.listen(0, "127.0.0.1", resolveTask));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = { webRoot, baseline, startedAt: new Date().toISOString(), tests: [], browserErrors: [] };
try {
  browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
  report.browserVersion = browser.version();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__parserMessages = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => window.__parserMessages.push({
          keys: Object.keys(event.data || {}), action: event.data?.action,
          sourceName: event.data?.sourceName, targetName: event.data?.targetName
        }));
      }
    };
  });
  const page = await context.newPage();
  page.on("pageerror", error => report.browserErrors.push(error.message));
  page.on("console", message => { if (message.type() === "warning" || message.type() === "error") report.browserErrors.push(message.text()); });
  await page.goto(origin + "/");
  await page.getByRole("button", { name: "跳过教程", exact: true }).click();
  await page.goto(origin + "/materials/import");
  const fileInput = page.locator('input[type="file"]');
  await fileInput.waitFor();
  page.on("dialog", dialog => dialog.accept());
  const cases = [{ name: "production-resume-pdf-import", file: join(root, "tmp/pdfs/resume-template-v2-synthetic.pdf"), expected: ["示例大学", "示例机构", "sample@example.test"] }];
  if (!baseline) cases.push(
    { name: "mixed-three-pages-and-CJK-CMap", file: join(output, "fixtures/fictional-mixed-multipage.pdf"), expected: ["PAGE 1 / 3", "PAGE 2 / 3", "PAGE 3 / 3", "示例大学", "示例公司", "产品经理"] },
    { name: "no-text-PDF", file: join(output, "fixtures/no-text.pdf"), error: "不支持 OCR" },
    { name: "password-protected-PDF", file: join(output, "fixtures/password-protected.pdf"), error: "密码保护" },
    { name: "page-limit", file: join(output, "fixtures/too-many-pages.pdf"), error: "300 页" },
    { name: "damaged-PDF", file: { name: "damaged.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\ninvalid contents\n%%EOF") }, error: "损坏或格式无效" },
    { name: "mislabeled-file", file: { name: "mislabeled.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") }, error: "不是有效的 PDF" },
    { name: "TXT-regression", file: { name: "fictional.txt", mimeType: "text/plain", buffer: Buffer.from("虚构工作经历\n示例公司 产品经理\n推进需求交付") }, expected: ["示例公司", "推进需求交付"] }
  );
  for (const item of cases) {
  await fileInput.setInputFiles(item.file);
  await page.waitForFunction(() => !document.querySelector('input[type="file"]')?.disabled && (document.querySelector(".success-message") || document.querySelector(".inline-error")), null, { timeout: 70000 });
  const sourceText = page.getByRole("textbox", { name: "从简历提取的文字", exact: true });
  const text = await sourceText.count() ? await sourceText.inputValue() : "";
  const errors = await page.locator(".inline-error").allTextContents();
  const passed = item.error ? errors.some(error => error.includes(item.error)) : !errors.length && item.expected.every(value => text.includes(value));
  report.tests.push({ name: item.name, passed, extractedCharacters: text.length, errors });
  console.log(`${item.name}: ${passed ? "passed" : "failed"}`);
  if (!baseline && !passed) throw new Error("Production import regression failed: " + item.name + " " + errors.join("; "));
  }
  report.parserMessages = await page.evaluate(() => window.__parserMessages);
  if (!baseline) {
    await page.goto(origin + "/resumes/new");
    await page.getByPlaceholder("例如：产品经理求职简历", { exact: true }).fill("虚构 PDF JD 回归");
    await page.getByRole("button", { name: "创建并编辑", exact: true }).click();
    await page.getByRole("button", { name: "项目信息与 JD", exact: true }).click();
    const jd = page.locator("label.form-field").filter({ has: page.locator(".field-label", { hasText: /^岗位 JD$/ }) }).locator("textarea");
    await jd.fill("原有虚构岗位要求");
    await page.locator('input[type="file"]').setInputFiles(join(output, "fixtures/fictional-mixed-multipage.pdf"));
    const preview = page.locator(".jd-preview-editor"); await preview.waitFor();
    const candidate = await preview.inputValue();
    if (!(candidate.includes("示例大学") && candidate.includes("PAGE 3 / 3")) || await jd.inputValue() !== "原有虚构岗位要求") throw new Error("JD候选提取或确认前边界错误");
    await page.getByRole("button", { name: "确认使用此 JD", exact: true }).click();
    if (await jd.inputValue() !== candidate) throw new Error("JD确认写入失败");
    report.tests.push({ name: "PDF-JD-candidate-before-confirmation", passed: true, extractedCharacters: candidate.length });
  }
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, baseline ? "baseline.png" : "verified.png"), fullPage: true });
  report.status = baseline ? "baseline-captured" : "passed";
} catch (error) { report.status = "failed"; report.failure = error.message; process.exitCode = 1; }
finally {
  await browser?.close(); await new Promise(resolveTask => server.close(resolveTask));
  await mkdir(output, { recursive: true });
  await writeFile(join(output, baseline ? "baseline.json" : "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, parserMessages: report.parserMessages?.slice(0, 3) }, null, 2));
}
