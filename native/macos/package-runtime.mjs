import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { lstat, open, mkdir, readFile, realpath, readdir, readlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { execFileSync, spawnSync } from "node:child_process";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const APP_ORIGIN = "http://127.0.0.1:41823";
export const stateRoot = () => join(homedir(), "Library/Application Support/求职工作台");
export function cleanEnvironment() {
  const env = { ...process.env, NODE_ENV: "production" };
  for (const key of Object.keys(env)) if (["NODE_OPTIONS", "NODE_PATH"].includes(key) || key.startsWith("DYLD_")) delete env[key];
  return env;
}
export async function hashFile(path) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex");
}
export async function secureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error("运行目录权限异常，请检查本机用户的求职工作台目录权限");
}
export async function privateRead(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 8192) throw new Error("本机控制文件无效");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}
export function localRequest(path, { method = "GET", headers = {}, body, timeoutMs = 3000, maxBytes = 16384, signal } = {}) {
  if (!path.startsWith("/api/") && path !== "/" && !path.startsWith("/assets/") && !["/profile", "/materials/import", "/resumes", "/settings", "/welcome", "/tutorial"].includes(path)) throw new Error("本机检查地址无效");
  return new Promise((resolveTask, reject) => {
    const req = request({ hostname: "127.0.0.1", port: 41823, path, method, headers, agent: false, signal }, response => {
      const chunks = []; let bytes = 0;
      response.on("data", chunk => { bytes += chunk.length; if (bytes > maxBytes) req.destroy(new Error("本机响应过长")); else chunks.push(chunk); });
      response.on("end", () => resolveTask({ status: response.statusCode, data: Buffer.concat(chunks) }));
      response.on("error", () => reject(new Error("本机服务连接中断")));
    });
    const timeout = setTimeout(() => req.destroy(new Error("本机服务连接超时")), timeoutMs);
    req.on("close", () => clearTimeout(timeout)); req.on("error", () => reject(new Error("无法连接本机服务")));
    req.end(body);
  });
}
export async function health(instanceId) {
  const result = await localRequest("/api/health");
  if (result.status !== 200) throw new Error("本机端口由其他服务占用");
  const value = JSON.parse(result.data.toString());
  if (value.status !== "ok" || value.instanceId !== instanceId || value.runtime?.platform !== "macos") throw new Error("本机端口不是本次工作台实例，请先停止旧版");
  return value;
}
export async function verifyPackage(root = PACKAGE_ROOT) {
  if (process.platform !== "darwin" || !process.versions.node.startsWith("24.")) throw new Error("请使用对应Mac包的随包Node24启动");
  const macOS = execFileSync("/usr/bin/sw_vers", ["--productVersion"], { encoding: "utf8", env: cleanEnvironment() }).trim();
  if (Number(macOS.split(".")[0]) < 14) throw new Error("此测试包要求macOS14或以上");
  if (process.arch === "x64") {
    // -i ignores an absent key on native Intel instead of treating it as a startup failure.
    const translated = spawnSync("/usr/sbin/sysctl", ["-in", "hw.optional.arm64"], { encoding: "utf8", env: cleanEnvironment() });
    if (translated.error || translated.status !== 0 || !["", "0", "1"].includes(translated.stdout.trim())) throw new Error("无法确认Mac运行架构，请反馈系统版本");
    if (translated.stdout.trim() === "1") throw new Error("Apple Silicon请使用arm64包，本次不通过Rosetta验收Intel包");
  }
  const metadata = JSON.parse(await readFile(join(root, "version.json"), "utf8"));
  if (metadata.platform !== "darwin" || metadata.architecture !== process.arch || metadata.nodeVersion !== process.versions.node || metadata.keychainBackend !== "koffi-file-keychain") throw new Error("测试包与当前芯片或运行时不匹配");
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error("文件清单无效，请重新解压测试包");
  const names = new Set(); const actual = [];
  const walk = async (directory, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name; if (name === "manifest.json" || entry.name === ".DS_Store" || entry.name.startsWith("._")) continue;
      if (entry.isDirectory()) await walk(join(directory, entry.name), name + "/"); else actual.push(name);
    }
  };
  await walk(root);
  for (const entry of manifest.files) {
    if (typeof entry.path !== "string" || entry.path.includes("\\") || entry.path.startsWith("/") || /^[A-Za-z]:/.test(entry.path) || entry.path.split("/").some(p => !p || p === "." || p === "..") || names.has(entry.path)) throw new Error("文件清单路径无效");
    names.add(entry.path);
    const path = join(root, entry.path); const info = await lstat(path);
    if (entry.link !== undefined) {
      if (!info.isSymbolicLink() || await readlink(path) !== entry.link) throw new Error("组件链接已损坏，请重新解压");
      const final = await realpath(path); if (!final.startsWith(await realpath(root) + sep)) throw new Error("组件链接越界");
    } else if (!info.isFile() || info.size !== entry.bytes || (info.mode & 0o777) !== entry.mode || await hashFile(path) !== entry.sha256) throw new Error("测试包文件或执行权限不完整，请重新解压原始ZIP");
  }
  if (names.size !== actual.length || actual.some(name => !names.has(name))) throw new Error("测试包存在未列入清单的文件，请使用原始解压包");
  return metadata;
}
