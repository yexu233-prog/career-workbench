import { gunzipSync } from "node:zlib";
import { posix } from "node:path";

// Inspect archive entries in memory: Windows never needs to create Mac symlinks.
export function safeArchivePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.split("/").some(p => p === "..")) throw new Error("归档路径不安全");
  const normalized = posix.normalize(value).replace(/\/$/, "");
  if (!normalized || normalized === ".") throw new Error("归档路径为空");
  return normalized;
}

export function readTarGzip(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 1024 * 1024 * 1024 });
  const entries = []; const names = new Set(); let offset = 0;
  const text = (block, start, size) => block.subarray(start, start + size).toString("utf8").split("\0")[0];
  const octal = value => { if (!/^[0-7]+$/.test(value.trim())) throw new Error("TAR数值无效"); return Number.parseInt(value.trim(), 8); };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) {
      if (tar.subarray(offset).some(byte => byte !== 0)) throw new Error("TAR结尾后有未检查内容");
      return entries;
    }
    const checksum = octal(text(header, 148, 8));
    const actual = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (checksum !== actual) throw new Error("TAR头校验失败");
    const prefix = text(header, 345, 155); const path = safeArchivePath((prefix ? prefix + "/" : "") + text(header, 0, 100));
    if (names.has(path)) throw new Error("归档存在重复路径"); names.add(path);
    const size = octal(text(header, 124, 12)); const mode = octal(text(header, 100, 8));
    const type = text(header, 156, 1) || "0";
    if (!["0", "2", "5"].includes(type)) throw new Error("归档含未支持的特殊条目");
    if (offset + size > tar.length) throw new Error("TAR正文不完整");
    const data = tar.subarray(offset, offset + size);
    const link = type === "2" ? text(header, 157, 100) : undefined;
    if (link && (link.startsWith("/") || link.includes("\\") || /^[A-Za-z]:/.test(link) || posix.normalize(posix.join(posix.dirname(path), link)).startsWith("../"))) throw new Error("归档链接越界");
    entries.push({ path, mode: mode & 0o777, type, data, ...(link ? { link } : {}) });
    offset += Math.ceil(size / 512) * 512;
  }
  throw new Error("TAR缺少结尾块");
}

export function inspectMachO(data, expectedArch) {
  if (data.length < 32 || data.readUInt32LE(0) !== 0xfeedfacf) throw new Error("不是受支持的单架构64位Mach-O");
  const cpu = data.readUInt32LE(4);
  const architecture = cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x64" : "unknown";
  if (architecture !== expectedArch) throw new Error("Mach-O实际架构与目标不符");
  const commands = data.readUInt32LE(16); const commandBytes = data.readUInt32LE(20);
  if (32 + commandBytes > data.length || commands > 10000) throw new Error("Mach-O命令区损坏");
  const version = number => `${number >>> 16}.${(number >>> 8) & 255}.${number & 255}`;
  let offset = 32; let minimumMacOS; let codeSignature = false;
  for (let i = 0; i < commands; i++) {
    if (offset + 8 > 32 + commandBytes) throw new Error("Mach-O命令缺失");
    const cmd = data.readUInt32LE(offset); const length = data.readUInt32LE(offset + 4);
    if (length < 8 || offset + length > 32 + commandBytes) throw new Error("Mach-O命令越界");
    if (cmd === 0x32) {
      if (length < 24 || data.readUInt32LE(offset + 8) !== 1) throw new Error("Mach-O并非macOS目标");
      minimumMacOS = version(data.readUInt32LE(offset + 12));
    } else if (cmd === 0x24) {
      if (length < 16) throw new Error("Mach-O系统版本命令损坏");
      minimumMacOS = version(data.readUInt32LE(offset + 8));
    } else if (cmd === 0x1d) {
      if (length < 16 || data.readUInt32LE(offset + 8) + data.readUInt32LE(offset + 12) > data.length) throw new Error("Mach-O签名区越界");
      codeSignature = true;
    }
    offset += length;
  }
  if (offset !== 32 + commandBytes || !minimumMacOS) throw new Error("Mach-O最低系统要求不可确认");
  if (Number(minimumMacOS.split(".")[0]) > 14) throw new Error(`组件要求macOS ${minimumMacOS}，不满足macOS14目标`);
  return { architecture, minimumMacOS, codeSignaturePresent: codeSignature, signatureVerified: false };
}
