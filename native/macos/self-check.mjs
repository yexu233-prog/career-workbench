import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PACKAGE_ROOT, verifyPackage, localRequest, health, stateRoot, secureDirectory, hashFile, cleanEnvironment } from "./package-runtime.mjs";
import { startOwnedService } from "./controller.mjs";

const report = { checkedAt: new Date().toISOString(), architecture: process.arch, node: process.versions.node, checks: [], humanAcceptance: "pending" };
let service;
const cancellation = new AbortController();
const check = async (name, action) => { cancellation.signal.throwIfAborted(); await action(); cancellation.signal.throwIfAborted(); report.checks.push({ name, status: "passed" }); console.log(`通过：${name}`); };
const stop = () => { cancellation.abort(new Error("自检已取消")); void service?.stop().catch(() => {}); };
for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.once(signal, stop);
try {
  console.log("自检仅使用虚构内容，不读取浏览器资料，也不读写已保存的API Key。请先停止其他工作台实例。");
  const metadata = await verifyPackage(); report.packageId = metadata.packageId; report.manifestSha256 = await hashFile(join(PACKAGE_ROOT, "manifest.json"));
  report.macOS = execFileSync("/usr/bin/sw_vers", ["--productVersion"], { encoding: "utf8", env: cleanEnvironment() }).trim();
  if (Number(report.macOS.split(".")[0]) < 14) throw new Error("本测试包要求macOS14或以上");
  report.checks.push({ name: "文件清单、权限、架构、Node版本", status: "passed" });
  await check("钥匙串绑定加载（不访问凭据）", () => new Promise((resolveTask, reject) => {
    const child = spawn(process.execPath, [join(PACKAGE_ROOT, "native/macos/keychain-helper.mjs"), "probe"], { stdio: "ignore", env: cleanEnvironment() });
    const cancelProbe = () => child.kill("SIGKILL");
    cancellation.signal.addEventListener("abort", cancelProbe, { once: true });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("钥匙串组件不能加载")); });
    child.once("close", code => { clearTimeout(timer); cancellation.signal.removeEventListener("abort", cancelProbe); code === 0 ? resolveTask() : reject(new Error("钥匙串组件不能加载或自检已取消，请反馈系统提示")); });
  }));
  service = await startOwnedService(metadata, cancellation.signal);
  await check("本机服务与实例身份", () => health(service.instanceId));
  await check("页面、深层路由、引用资源", async () => {
    for (const path of ["/", "/profile", "/materials/import", "/resumes", "/settings", "/welcome", "/tutorial"]) {
      const page = await localRequest(path);
      if (page.status !== 200 || !/<!doctype html/i.test(page.data.toString())) throw new Error("页面检查失败");
      if (path === "/") for (const match of page.data.toString().matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) {
        const asset = await localRequest(match[1], { maxBytes: 20000000 });
        if (asset.status !== 200 || !asset.data.length) throw new Error("页面引用资源缺失");
      }
    }
  });
  await check("随包字体与PDF状态", async () => {
    const font = await localRequest("/api/pdf/font", { maxBytes: 30000000 });
    const status = await localRequest("/api/pdf/status"); const value = JSON.parse(status.data.toString());
    if (font.status !== 200 || !font.data.length || !value.available || !value.fontAvailable) throw new Error("PDF资源未就绪");
  });
  await check("真实A4 PDF生成", async () => {
    const status = JSON.parse((await localRequest("/api/pdf/status")).data.toString());
    const body = JSON.stringify({ requestId: randomUUID(), templateId: "standard-single-column", templateVersion: 2, pageCount: 1, html: '<div class="resume-pages"><div class="resume-paper"><h1>虚构测试 Fictional Resume</h1><p>学校在前 · 公司在前 · 求职意向</p></div></div>', css: '@font-face{font-family:TestNoto;src:url(/api/pdf/font)}@page{size:A4;margin:20mm}.resume-paper{font-family:TestNoto,sans-serif}' });
    const pdf = await localRequest("/api/pdf/render", { method: "POST", headers: { "content-type": "application/json", "x-pdf-client-token": status.clientToken }, body, timeoutMs: 140000, maxBytes: 5000000, signal: cancellation.signal });
    if (pdf.status !== 200 || pdf.data.length < 500 || pdf.data.subarray(0, 5).toString() !== "%PDF-" || !pdf.data.subarray(-64).toString().includes("%%EOF")) throw new Error("PDF生成失败");
  });
  await check("受保护停止与服务退出", async () => { await service.stop(); if (await service.exited !== 0) throw new Error("服务异常退出"); });
  report.status = "automatic-smoke-passed-human-pending";
} catch (error) {
  report.status = "failed"; report.failure = error instanceof Error ? error.message : "自检未完成";
  console.error(report.failure); process.exitCode = 1;
} finally {
  try { await service?.stop(); } catch { report.status = "failed"; report.failure = "服务清理未确认，请使用停止入口"; process.exitCode = 1; }
  if (process.platform === "darwin") {
    await secureDirectory(stateRoot()); const reports = join(stateRoot(), "验收记录"); await secureDirectory(reports);
    const file = join(reports, `mac-check-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    console.log(`自检记录：${file}\nSafari、Chrome、钥匙串实际存取及版式仍需人工验收。`);
  }
}
