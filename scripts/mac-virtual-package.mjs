import { createHash } from "node:crypto";
import { posix } from "node:path";
import JSZip from "jszip";
import { safeArchivePath } from "./mac-prebuilt-inspection.mjs";

const digest = data => createHash("sha256").update(data).digest("hex");
const folded = path => path.normalize("NFC").toLowerCase();
export function inspectZipDirectory(data) {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50 && i + 22 + data.readUInt16LE(i + 20) === data.length) { end = i; break; }
  }
  if (end < 0 || data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6)) throw new Error("ZIP结尾或分卷信息无效");
  const count = data.readUInt16LE(end + 10); const offset = data.readUInt32LE(end + 16); const size = data.readUInt32LE(end + 12);
  if (count === 65535 || offset + size !== end || data.readUInt16LE(end + 8) !== count) throw new Error("ZIP64或目录结构不受支持");
  const names = new Set(); const entries = []; let position = offset;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || data.readUInt32LE(position) !== 0x02014b50) throw new Error("ZIP目录损坏");
    const flags = data.readUInt16LE(position + 8); const method = data.readUInt16LE(position + 10);
    const nameSize = data.readUInt16LE(position + 28); const extraSize = data.readUInt16LE(position + 30); const commentSize = data.readUInt16LE(position + 32);
    const next = position + 46 + nameSize + extraSize + commentSize;
    if (next > end || flags & 1 || ![0, 8].includes(method)) throw new Error("ZIP加密、压缩或条目信息异常");
    const original = data.subarray(position + 46, position + 46 + nameSize).toString("utf8");
    const path = safeArchivePath(original);
    if (names.has(folded(path))) throw new Error("ZIP含重复或大小写冲突的路径"); names.add(folded(path));
    entries.push({ path, original, directory: original.endsWith("/"), mode: data.readUInt32LE(position + 38) >>> 16 });
    position = next;
  }
  if (position !== end) throw new Error("ZIP目录大小不符");
  return entries;
}

export async function readZipEntries(bytes) {
  const directory = inspectZipDirectory(bytes);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const entries = [];
  for (const info of directory) {
    if (info.directory) continue;
    const file = zip.file(info.original); if (!file || file.unsafeOriginalName !== undefined && file.unsafeOriginalName !== info.original) throw new Error("ZIP路径被隐式修改");
    const data = await file.async("nodebuffer");
    const kind = info.mode & 0o170000;
    if (![0, 0o100000, 0o120000].includes(kind)) throw new Error("ZIP包含特殊文件");
    entries.push({ path: info.path, data, mode: info.mode & 0o777 || 0o644, ...(kind === 0o120000 ? { link: data.toString("utf8") } : {}) });
  }
  validateVirtualEntries(entries);
  return entries;
}

export function validateVirtualEntries(entries) {
  const files = new Map(); const names = new Set(); const directories = new Set();
  for (const entry of entries) {
    const path = safeArchivePath(entry.path);
    if (path !== entry.path || names.has(folded(path))) throw new Error("包含重复或非规范路径");
    names.add(folded(path)); files.set(path, entry);
    let parent = posix.dirname(path); while (parent !== ".") { directories.add(parent); parent = posix.dirname(parent); }
  }
  for (const directory of directories) if (names.has(folded(directory))) throw new Error("包的文件与目录冲突");
  function resolveLink(path, visited = new Set()) {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0, index).join("/"); const item = files.get(prefix);
      if (!item?.link) continue;
      if (visited.has(prefix) || visited.size > 40) throw new Error("包内链接循环");
      visited.add(prefix);
      const link = item.link;
      if (link.startsWith("/") || link.includes("\\") || link.includes("\0") || /^[A-Za-z]:/.test(link)) throw new Error("包链接绝对路径或无效");
      const target = posix.normalize(posix.join(posix.dirname(prefix), link));
      if (target === "." || target === ".." || target.startsWith("../") || prefix.startsWith(target + "/")) throw new Error("包链接越界或指向祖先");
      return resolveLink(posix.join(target, ...parts.slice(index)), visited);
    }
    if (!files.has(path) && !directories.has(path)) throw new Error("包存在悬空链接");
    return path;
  }
  for (const entry of entries) if (entry.link !== undefined) {
    if (!entry.link) throw new Error("包包含空链接"); resolveLink(entry.path);
  }
}
export function virtualManifest(entries) {
  validateVirtualEntries(entries);
  return { schemaVersion: 1, files: entries.filter(entry => entry.path !== "manifest.json").map(entry => entry.link !== undefined ? { path: entry.path, link: entry.link } : { path: entry.path, bytes: entry.data.length, mode: entry.mode, sha256: digest(entry.data) }).sort((a, b) => a.path.localeCompare(b.path, "en")) };
}
export function createVirtualZip(entries, name) {
  safeArchivePath(name); validateVirtualEntries(entries); const zip = new JSZip();
  for (const entry of entries) zip.file(`${name}/${entry.path}`, entry.link ?? entry.data, { unixPermissions: (entry.link !== undefined ? 0o120000 : 0o100000) | entry.mode, createFolders: true });
  for (const file of Object.values(zip.files)) if (file.dir) file.unixPermissions = 0o40755;
  return zip;
}
