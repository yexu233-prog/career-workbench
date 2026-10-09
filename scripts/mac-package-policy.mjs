import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, lstat, readlink, readFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, sep, dirname } from "node:path";

export const MAC_TARGETS = ["arm64", "x64"];
export const NODE_MAC = {
  version: "24.19.0",
  arm64: "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
  x64: "d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316"
};
export function assertMacBuildHost(platform = process.platform, arch = process.arch) {
  if (platform !== "darwin" || !MAC_TARGETS.includes(arch)) throw new Error("须在 macOS arm64/x64 构建机执行；Windows不能代替Mac原生编译与验收");
}
export function assertTarget(arch) { if (!MAC_TARGETS.includes(arch)) throw new Error("Mac目标架构无效"); return arch; }
export function assertBinaryArchitecture(output, arch) {
  assertTarget(arch);
  const allowed = arch === "x64" ? "x86_64" : "arm64";
  if (output.trim() !== allowed) throw new Error(`原生组件不是单一目标架构 ${arch}`);
}
export function assertNodeRuntime(output, arch) {
  assertTarget(arch);
  if (output.trim() !== `${NODE_MAC.version}|darwin|${arch}`) throw new Error("随包Node版本、系统或架构不匹配");
}
export async function sha256(path) {
  const hash = createHash("sha256"); for await (const data of createReadStream(path)) hash.update(data); return hash.digest("hex");
}
export function assertInternalLink(root, file, target) {
  if (!target || target.startsWith("/") || /^[A-Za-z]:/.test(target)) throw new Error("Mac包包含绝对符号链接");
  const final = resolve(dirname(file), target); const base = resolve(root);
  if (final !== base && !final.startsWith(base + sep)) throw new Error("Mac包符号链接越界");
}
async function collect(root, directory = root) {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const file = join(directory, name); const info = await lstat(file);
    const path = relative(root, file).split(sep).join("/");
    if (path === "manifest.json") continue;
    if (info.isDirectory()) result.push(...await collect(root, file));
    else if (info.isSymbolicLink()) { const target = await readlink(file); assertInternalLink(root, file, target); result.push({ path, link: target }); }
    else if (info.isFile()) result.push({ path, bytes: info.size, mode: info.mode & 0o777, sha256: await sha256(file) });
    else throw new Error("Mac包不允许设备或特殊文件");
  }
  return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
export async function createMacManifest(root) {
  const files = await collect(root); const manifest = { schemaVersion: 1, files };
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"); return manifest;
}
export async function verifyMacManifest(root) {
  const saved = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  if (saved.schemaVersion !== 1 || JSON.stringify(saved.files) !== JSON.stringify(await collect(root))) throw new Error("Mac包文件/权限/链接校验失败");
  return saved;
}
