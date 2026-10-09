import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { sha256 } from "./mac-package-policy.mjs";

export const ACCEPTED_ARM64 = {
  packageId: "03cca4c3-135f-4228-b7b8-d4b52058da6c",
  zipSha256: "7dafd4589a2c9d5282a2f989621bd3629aba4fe3a536894d8414ffdf3b703bd8",
  appVersion: "0.1.0-test", date: "2026-10-09", evidenceType: "user-attestation",
  system: "macOS 14 / Apple Silicon", safariVersion: null, chromeVersion: null
};
const critical = path => /^(?:app|web|runtime|native|node_modules|assets)\//.test(path);
const digest = data => createHash("sha256").update(data).digest("hex");
const stablePath = path => path.startsWith("web/assets/") ? path.replace(/-[\w-]{8}(?=\.(?:js|mjs|css)$)/, "-BUILDHASH") : path;
function index(entries) {
  const mapped = new Map();
  for (const entry of entries.filter(entry => critical(entry.path))) {
    const key = stablePath(entry.path);
    if (mapped.has(key)) throw new Error("运行文件映射存在冲突，不能复用参考验收");
    mapped.set(key, entry);
  }
  return mapped;
}
function normalizedText(data, version, entries) {
  let text = data.toString("utf8");
  for (const quote of ['"', "'", "`"]) text = text.replaceAll(quote + version + quote, quote + "APP_RELEASE_VERSION" + quote);
  for (const entry of entries.values()) if (stablePath(entry.path) !== entry.path) {
    text = text.replaceAll(entry.path.split("/").at(-1), stablePath(entry.path).split("/").at(-1));
  }
  return text;
}
export async function compareRuntimePayload(current, previousManifest, readPrevious, previousVersion, version) {
  const next = index(current); const before = index(previousManifest);
  if (!next.size || next.size !== before.size || [...next.keys()].some(key => !before.has(key))) throw new Error("运行文件增删，必须重新进行Mac验收");
  const normalizedChanges = [];
  for (const [key, entry] of next) {
    const old = before.get(key);
    if (entry.link !== old.link || (entry.link === undefined && entry.mode !== old.mode)) throw new Error("运行文件权限或链接变化，必须重新进行Mac验收");
    if (entry.link !== undefined || digest(entry.data) === old.sha256) continue;
    if (key !== "app/server.mjs" && !/^web\/.*\.(?:js|mjs|html|css)$/.test(key)) throw new Error("原生或运行组件内容变化，必须重新进行Mac验收");
    const oldData = await readPrevious(old.path);
    if (digest(oldData) !== old.sha256) throw new Error("参考包文件与清单不符");
    if (normalizedText(entry.data, version, next) !== normalizedText(oldData, previousVersion, before)) throw new Error("除版本及其构建引用外存在运行改动，必须重新进行Mac验收：" + key);
    normalizedChanges.push(entry.path);
  }
  return { checkedFiles: next.size, normalizedChanges, allowedDifferences: "displayed-version-and-content-addressed-references-only" };
}
export async function verifyAcceptedArm64(entries, referenceZip, version) {
  if (!referenceZip || await sha256(referenceZip) !== ACCEPTED_ARM64.zipSha256) throw new Error("公开arm64包须提供已确认验收的准确参考ZIP");
  const zip = await JSZip.loadAsync(await readFile(referenceZip));
  const prefix = `career-workbench-${ACCEPTED_ARM64.appVersion}-mac-arm64/`;
  const metadata = JSON.parse(await zip.file(prefix + "version.json").async("string"));
  if (metadata.packageId !== ACCEPTED_ARM64.packageId || metadata.architecture !== "arm64") throw new Error("参考验收包身份不一致");
  const manifest = JSON.parse(await zip.file(prefix + "manifest.json").async("string"));
  return { ...ACCEPTED_ARM64, payloadComparison: await compareRuntimePayload(entries, manifest.files, path => zip.file(prefix + path).async("nodebuffer"), ACCEPTED_ARM64.appVersion, version) };
}
export function macSupportStatus(arch, referenceVerified) {
  if (!["arm64", "x64"].includes(arch)) throw new Error("Mac架构无效");
  if (arch === "x64") return { supportStatus: "experimental-unverified", label: "实验性、未完成实机验证", macRuntime: "pending", human: "pending" };
  return referenceVerified
    ? { supportStatus: "preview-reference-accepted", label: "Apple Silicon：参考版本实机验收通过，重建包已核对运行文件", macRuntime: "not-executed-on-this-archive", human: "reference-user-confirmed" }
    : { supportStatus: "pending-acceptance", label: "Apple Silicon：本包待实机验收", macRuntime: "pending", human: "pending" };
}
