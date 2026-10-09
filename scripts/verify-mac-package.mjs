import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile, writeFile, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { once } from "node:events";
import { assertMacBuildHost, assertTarget, assertNodeRuntime, assertBinaryArchitecture, verifyMacManifest, createMacManifest, sha256 } from "./mac-package-policy.mjs";

const root = resolve(process.argv[2] ?? "");
const resources = join(root, "求职工作台.app/Contents/Resources");
const app = join(root, "求职工作台.app");
const base = "http://127.0.0.1:41823";
function text(command, args) { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function nonempty(file) { const value = await stat(file); if (!value.isFile() || !value.size) throw new Error("发布组件缺失或为空"); }
async function get(path) { const response = await fetch(base + path, { signal: AbortSignal.timeout(3000), redirect: "error" }); if (!response.ok) throw new Error("本机自检接口失败"); return response; }
async function ensurePortFree() {
  const server = createServer(); await new Promise((resolveTask, reject) => { server.once("error", reject); server.listen(41823, "127.0.0.1", resolveTask); });
  await new Promise((resolveTask, reject) => server.close((error) => error ? reject(error) : resolveTask()));
}
async function main() {
  if (!process.argv[2]) throw new Error("缺少Mac候选包路径");
  assertMacBuildHost();
  const metadata = JSON.parse(await readFile(join(resources, "version.json"), "utf8"));
  const arch = assertTarget(metadata.architecture);
  if (process.arch !== arch) throw new Error("当前机器不是目标原生架构；不会自动安装Rosetta或声称该架构验收通过");
  if (metadata.platform !== "darwin" || metadata.playwrightVersion !== "1.64.0" || metadata.chromiumRevision !== "1248") throw new Error("Mac组件元数据不符");
  await verifyMacManifest(root);
  const node = join(resources, "runtime/node/node"); const helper = join(resources, "native/keychain-helper");
  if (typeof metadata.chromiumExecutable !== "string" || !metadata.chromiumExecutable.startsWith("runtime/chromium/") || metadata.chromiumExecutable.split("/").some((part) => part === ".." || !part)) throw new Error("PDF组件路径无效");
  const engine = join(resources, metadata.chromiumExecutable);
  for (const file of [node, helper, engine, join(app, "Contents/MacOS/Launcher"), join(resources, "app/server.mjs"), join(resources, "web/index.html"), join(resources, "assets/fonts/NotoSansCJKsc-Regular.otf"), join(resources, "assets/fonts/OFL.txt"), join(resources, "LICENSE"), join(resources, "licenses/README.md")]) await nonempty(file);
  for (const file of [node, helper, engine, join(app, "Contents/MacOS/Launcher")]) assertBinaryArchitecture(text("/usr/bin/lipo", ["-archs", file]), arch);
  assertNodeRuntime(text(node, ["-p", "[process.versions.node,process.platform,process.arch].join('|')"]), arch);
  text("/usr/bin/codesign", ["--verify", "--strict", app]);
  const helperResult = spawn(helper, ["invalid-self-check-operation"], { stdio: "ignore" });
  if ((await once(helperResult, "close"))[0] !== 2) throw new Error("钥匙串辅助程序未按约定拒绝无效操作");
  const { chromium } = await import(pathToFileURL(join(resources, "node_modules/playwright-core/index.mjs")).href);
  const browser = await chromium.launch({ executablePath: engine, headless: true, timeout: 60_000 });
  let credits;
  try {
    if (browser.version() !== metadata.chromiumVersion) throw new Error("随包PDF引擎版本不匹配");
    const page = await browser.newPage(); await page.goto("chrome://credits", { timeout: 30_000 }); credits = await page.content();
    if (credits.length < 10_000 || !/license/i.test(credits)) throw new Error("未取得完整Chromium第三方声明");
  } finally { await browser.close(); }
  await ensurePortFree();
  const temporary = await mkdtemp(join(tmpdir(), "career-workbench-mac-check-"));
  const token = randomUUID() + randomUUID(); const instanceId = randomUUID(); const tokenFile = join(temporary, "control.token");
  await writeFile(tokenFile, token, { mode: 0o600, flag: "wx" });
  let child; let exited;
  try {
    const environment = { ...process.env, NODE_ENV: "production" }; delete environment.NODE_OPTIONS; delete environment.NODE_PATH;
    child = spawn(node, [join(resources, "app/server.mjs"), "--production", "--web-root", join(resources, "web"), "--font-file", join(resources, "assets/fonts/NotoSansCJKsc-Regular.otf"), "--keychain-helper", helper, "--chromium-executable", engine, "--control-token-file", tokenFile, "--instance-id", instanceId], { cwd: resources, stdio: "ignore", env: environment });
    exited = new Promise((resolveTask) => { child.once("error", () => resolveTask(-1)); child.once("close", resolveTask); });
    let healthy = false;
    for (let count = 0; count < 80; count += 1) {
      if (child.exitCode !== null) break;
      try { const health = await (await get("/api/health")).json(); healthy = health.status === "ok" && health.instanceId === instanceId && health.runtime?.platform === "macos" && health.appVersion === metadata.appVersion; if (healthy) break; } catch {}
      await new Promise((resolveTask) => setTimeout(resolveTask, 250));
    }
    if (!healthy) throw new Error("本次实例未启动；可能端口占用，不会使用其他实例代替自检");
    for (const path of ["/", "/profile", "/materials/import", "/resumes", "/settings", "/welcome", "/tutorial"]) if (!(await (await get(path)).text()).toLowerCase().includes("<!doctype html")) throw new Error("网页深层路由失败");
    const html = await (await get("/")).text();
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) if (!(await (await get(match[1])).arrayBuffer()).byteLength) throw new Error("引用资源为空");
    if (!(await (await get("/api/pdf/font")).arrayBuffer()).byteLength) throw new Error("随包字体不可读取");
    const pdfStatus = await (await get("/api/pdf/status")).json();
    if (!pdfStatus.available || !pdfStatus.fontAvailable || !pdfStatus.clientToken) throw new Error("PDF状态未就绪");
    const pdf = await fetch(base + "/api/pdf/render", { method: "POST", headers: { "content-type": "application/json", "x-pdf-client-token": pdfStatus.clientToken }, body: JSON.stringify({ requestId: randomUUID(), templateId: "standard-single-column", templateVersion: 2, pageCount: 1, html: '<div class="resume-pages"><div class="resume-paper"><h1>虚构测试 Fictional Resume</h1><p>学校在前 · 公司在前 · 求职意向</p></div></div>', css: '@font-face{font-family:TestNoto;src:url(/api/pdf/font)}@page{size:A4;margin:20mm}.resume-paper{font-family:TestNoto,sans-serif}' }), signal: AbortSignal.timeout(70_000) });
    const bytes = Buffer.from(await pdf.arrayBuffer());
    if (!pdf.ok || bytes.length < 500 || bytes.subarray(0, 5).toString() !== "%PDF-" || !bytes.subarray(-64).toString().includes("%%EOF")) throw new Error("真实PDF冒烟失败");
    const stop = await fetch(base + "/api/system/stop", { method: "POST", headers: { "x-control-token": token }, signal: AbortSignal.timeout(3000), redirect: "error" });
    if (!stop.ok) throw new Error("受保护停止失败");
    const exit = await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("服务停止超时")), 10_000).unref())]);
    if (exit !== 0) throw new Error("服务未正常退出");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); const escalation = setTimeout(() => child.kill("SIGKILL"), 5000); escalation.unref(); try { await exited; } finally { clearTimeout(escalation); } }
    await rm(temporary, { recursive: true, force: true }); // Only this newly created, owned test directory.
  }
  await writeFile(join(resources, "licenses/chromium/credits.html"), credits);
  metadata.validation = "automatic-smoke-passed-human-pending"; metadata.licenseStatus = "chromium-credits-included"; metadata.checkedAt = new Date().toISOString(); metadata.checkedArchitecture = process.arch;
  await writeFile(join(resources, "version.json"), JSON.stringify(metadata, null, 2) + "\n");
  await writeFile(join(root, "验收状态.md"), `# 自动冒烟通过，人工验收待完成\n\n架构：${arch}。Node、引擎版本、资源、路由、字体、真实PDF生成及受保护停止已自动检查。尚未验收Safari、Word、钥匙串授权、PDF视觉或干净Mac。\n`);
  text("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", app]); text("/usr/bin/codesign", ["--verify", "--strict", app]);
  await createMacManifest(root); await verifyMacManifest(root);
  const zip = join(dirname(root), `${basename(root)}-${randomUUID().slice(0, 8)}.zip`);
  text("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", root, zip]);
  const hash = await sha256(zip); const checksum = zip + ".sha256";
  await writeFile(checksum, `${hash}  ${basename(zip)}\n`, { flag: "wx" });
  if (await sha256(zip) !== hash) throw new Error("ZIP校验失败");
  console.log(`Mac测试ZIP：${zip}\nSHA-256：${hash}\n人工验收仍待完成，未上传。`);
}
main().catch(() => { console.error("Mac包自检未通过：请核对对应架构、端口、组件、许可和引擎；不生成新的可交付ZIP。"); process.exitCode = 1; });
