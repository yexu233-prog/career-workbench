import { stat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { verifyFileManifest } from "./release-metadata.mjs";
const root = resolve(process.argv[2] ?? ""); if (!root) throw new Error("缺少发布包目录");
const node = join(root, "runtime", "node", "node.exe"); const server = join(root, "app", "server.mjs"); const web = join(root, "web"); const font = join(root, "assets", "fonts", "NotoSansCJKsc-Regular.otf");
const required = [server, join(web, "index.html"), node, font, join(root, "assets", "fonts", "OFL.txt"), join(root, "assets", "fonts", "README.md"), join(root, "scripts", "start-app.ps1"), join(root, "scripts", "stop-app.ps1"), join(root, "startup.cmd"), join(root, "shutdown.cmd"), join(root, "README.md"), join(root, "使用说明.md"), join(root, "version.json"), join(root, "发行说明.md"), join(root, "manifest.json"), join(root, "licenses", "README.md"), join(root, "licenses", "node", "LICENSE.txt"), join(root, "licenses", "fonts", "NotoSansCJKsc-OFL.txt")];
for (const file of required) { const info = await stat(file).catch(() => undefined); if (!info?.isFile() || info.size === 0) throw new Error(`发布包文件缺失或为空：${file}`); }
const manifest = await verifyFileManifest(root);
const projectLicense = await readFile(join(root, "LICENSE"), "utf8");
if (!projectLicense.startsWith("MIT License") || !projectLicense.includes("Copyright (c) 2026 叶许")) throw new Error("发布包缺少正确的项目 MIT 许可证");
const version = JSON.parse(await readFile(join(root, "version.json"), "utf8"));
if (version.projectLicense !== "MIT") throw new Error("发布包项目许可证元数据错误");
if (version.schemaVersion !== 1 || version.packageName !== root.split(/[\\/]/).at(-1) || !/^[0-9a-f]{40}$/.test(version.gitCommit ?? "") && version.gitCommit !== null || !Number.isInteger(version.databaseSchemaVersion) || ![1, 2].includes(version.templateVersion) || !Number.isFinite(Date.parse(version.builtAtUtc)) || manifest.fileCount < 15) throw new Error("发布包版本元数据无效");
const runtime = await new Promise((resolve, reject) => { const child = spawn(node, ["-p", "[process.versions.node, process.platform, process.arch].join('|')"]); let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error("随包 Node 无法执行"))); });
if (!/^24\.[^|]+\|win32\|x64$/.test(runtime)) throw new Error(`发布包 Node 运行时不符合目标：${runtime}`);
if (runtime !== `${version.nodeVersion}|${version.platform}|${version.architecture}`) throw new Error("版本元数据与随包 Node 不一致");
async function checkFiles(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const file = join(directory, entry.name); if (entry.isDirectory()) await checkFiles(file); else if ((await stat(file)).size === 0) throw new Error(`静态资源为空：${file}`); } }
await checkFiles(web);
const base = "http://127.0.0.1:41823"; let owned;
async function json(path) { const response = await fetch(`${base}${path}`); if (!response.ok) throw new Error(`接口失败：${path}`); return response.json(); }
try {
  let health; try { health = await json("/api/health"); } catch {}
  if (health) throw new Error("发布包自检需要空闲的 41823 端口；请先停止正在运行的求职工作台");
  owned = spawn(node, [server, "--production", "--web-root", web, "--font-file", font], { cwd: root, windowsHide: true, stdio: "ignore" });
  for (let attempt = 0; attempt < 40; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 250)); try { health = await json("/api/health"); if (health.status === "ok") break; } catch {} }
  if (health?.status !== "ok" || health.appVersion !== version.appVersion) throw new Error("健康接口或应用版本检查失败");
  for (const path of ["/", "/resumes", "/settings"]) { const response = await fetch(`${base}${path}`); const text = await response.text(); if (!response.ok || !text.toLowerCase().includes("<!doctype html")) throw new Error(`深层路由检查失败：${path}`); }
  const pdf = await json("/api/pdf/status"); if (!pdf.clientToken) throw new Error("PDF 状态接口检查失败"); const fontResponse = await fetch(`${base}/api/pdf/font`); if (!fontResponse.ok || (await fontResponse.arrayBuffer()).byteLength === 0) throw new Error("字体接口检查失败");
  console.log("Release package smoke checks passed.");
} finally {
  if (owned && owned.exitCode === null) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("发布包临时服务未能及时退出")), 5000);
      owned.once("exit", () => { clearTimeout(timeout); resolve(); });
      owned.kill();
    });
  }
}
