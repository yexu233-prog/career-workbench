import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink, rmdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { PACKAGE_ROOT, APP_ORIGIN, stateRoot, secureDirectory, privateRead, cleanEnvironment, localRequest, health } from "./package-runtime.mjs";

export async function assertPortFree() {
  const server = createServer();
  await new Promise((resolveTask, reject) => { server.once("error", () => reject(new Error("41823端口已被占用，请先用旧版的停止入口结束服务"))); server.listen(41823, "127.0.0.1", resolveTask); });
  await new Promise(resolveTask => server.close(resolveTask));
}
async function readOwner(lock) { return JSON.parse(await privateRead(join(lock, "owner.json"))); }
async function removeOwnedLock(lock, instanceId) {
  if ((await readOwner(lock)).instanceId !== instanceId) throw new Error("运行状态已变化，保留控制文件");
  for (const name of ["control.token", "owner.json"]) await unlink(join(lock, name)).catch(error => { if (error.code !== "ENOENT") throw error; });
  await rmdir(lock);
}
async function releaseStaleLock(lock) {
  const owner = await readOwner(lock);
  if (!Number.isInteger(owner.launcherPid) || owner.launcherPid < 1 || typeof owner.instanceId !== "string") throw new Error("运行记录不完整，请关闭启动窗口后重新尝试");
  let running = true;
  try { process.kill(owner.launcherPid, 0); } catch (error) { if (error.code === "ESRCH") running = false; else throw error; }
  if (running) throw new Error("已有工作台启动窗口，请先使用该包的停止入口或关闭原窗口");
  await assertPortFree(); // Never send a signal to a PID from a stale record.
  await removeOwnedLock(lock, owner.instanceId);
}
async function waitForExit(exited, ms) {
  let timer;
  try { return await Promise.race([exited.then(() => true), new Promise(resolveTask => { timer = setTimeout(() => resolveTask(false), ms); })]); }
  finally { clearTimeout(timer); }
}
export async function startOwnedService(metadata, signal) {
  signal?.throwIfAborted();
  const root = await realpath(PACKAGE_ROOT); const state = stateRoot(); const lock = join(state, "run.lock");
  await secureDirectory(state);
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; await secureDirectory(lock); await releaseStaleLock(lock); await mkdir(lock, { mode: 0o700 }); }
  const instanceId = randomUUID(); const token = randomBytes(32).toString("hex");
  try { await writeFile(join(lock, "owner.json"), JSON.stringify({ instanceId, launcherPid: process.pid, packageRoot: root }), { mode: 0o600, flag: "wx" }); }
  catch (error) { await rmdir(lock).catch(() => {}); throw error; } // Only remove our newly created, still-empty directory.
  let child; let exited; let stopTask;
  const stop = () => stopTask ??= (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { await health(instanceId); await localRequest("/api/system/stop", { method: "POST", headers: { "x-control-token": token } }); } catch { /* Only terminate our own child below. */ }
      if (!await waitForExit(exited, 10000)) { child.kill("SIGTERM"); if (!await waitForExit(exited, 5000)) child.kill("SIGKILL"); }
      await exited;
    }
    await removeOwnedLock(lock, instanceId);
  })();
  try {
    await writeFile(join(lock, "control.token"), token, { mode: 0o600, flag: "wx" });
    await assertPortFree();
    signal?.throwIfAborted();
    child = spawn(join(root, "runtime/node/node"), [join(root, "app/server.mjs"), "--production", "--web-root", join(root, "web"), "--font-file", join(root, "assets/fonts/NotoSansCJKsc-Regular.otf"), "--keychain-script", join(root, "native/macos/keychain-helper.mjs"), "--chromium-executable", join(root, metadata.chromiumExecutable), "--control-token-file", join(lock, "control.token"), "--instance-id", instanceId], { cwd: root, env: cleanEnvironment(), detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
    exited = new Promise(resolveTask => { child.once("error", () => resolveTask(-1)); child.once("close", resolveTask); });
    let ready = false; const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error("启动已取消");
      if (child.exitCode !== null || child.signalCode !== null) break;
      try { await health(instanceId); ready = true; break; } catch {}
      await new Promise(resolveTask => setTimeout(resolveTask, 250));
    }
    if (!ready) throw new Error("工作台启动失败，请确认已停止旧包、包文件完整且系统允许运行随包Node");
    return { instanceId, exited, stop };
  } catch (error) { await stop(); throw error; }
}
export async function stopExistingService() {
  const lock = join(stateRoot(), "run.lock"); await secureDirectory(stateRoot());
  let owner;
  try { owner = await readOwner(lock); } catch (error) { if (error.code === "ENOENT") { console.log("没有本包的运行记录。"); return; } throw error; }
  if (owner.packageRoot !== await realpath(PACKAGE_ROOT)) throw new Error("当前运行的是其他目录的测试包，请使用原包的停止入口");
  try { await health(owner.instanceId); }
  catch { await releaseStaleLock(lock); console.log("服务已退出，已清理失效运行记录。"); return; }
  const token = (await privateRead(join(lock, "control.token"))).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("控制信息无效，不能停止此实例");
  const result = await localRequest("/api/system/stop", { method: "POST", headers: { "x-control-token": token } });
  if (result.status !== 200) throw new Error("停止请求未获确认，请回到启动窗口重试");
  for (let i = 0; i < 60; i++) {
    try { await assertPortFree(); console.log("工作台已停止。"); return; } catch {}
    await new Promise(resolveTask => setTimeout(resolveTask, 250));
  }
  throw new Error("仍在结束任务，请稍后重试停止入口");
}
export async function chooseBrowser(signal) {
  await secureDirectory(stateRoot());
  let preferred = "1";
  try { const p = JSON.parse(await privateRead(join(stateRoot(), "browser.json"))); if (p.browser === "chrome") preferred = "2"; } catch {}
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await terminal.question(`选择浏览器：1 Safari，2 Chrome，0 退出（回车使用${preferred === "1" ? "Safari" : "Chrome"}）：`, { signal })).trim() || preferred;
    if (answer === "0") return null;
    if (!["1", "2"].includes(answer)) throw new Error("请选择1或2后重新启动");
    const browser = answer === "1" ? "safari" : "chrome";
    // Replace only this app's non-secret preference; no browser data is touched.
    const path = join(stateRoot(), "browser.json");
    const { open, constants } = await import("node:fs/promises").then(async fs => ({ ...fs, constants: (await import("node:fs")).constants }));
    const handle = await open(path, constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_TRUNC, 0o600);
    try { await handle.writeFile(JSON.stringify({ browser })); } finally { await handle.close(); }
    return browser;
  } finally { terminal.close(); }
}
export function openBrowser(browser) {
  return new Promise((resolveTask, reject) => {
    const child = spawn("/usr/bin/open", ["-b", browser === "safari" ? "com.apple.Safari" : "com.google.Chrome", APP_ORIGIN], { stdio: "ignore", env: cleanEnvironment() });
    child.once("error", () => reject(new Error("无法打开所选浏览器，请安装后重试或重新选择")));
    child.once("close", code => code === 0 ? resolveTask() : reject(new Error("无法打开所选浏览器，请安装后重试或重新选择")));
  });
}
