import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, rename, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { NODE_MAC, sha256 } from "./mac-package-policy.mjs";
import { readTarGzip, inspectMachO } from "./mac-prebuilt-inspection.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "tmp/mac-prebuilt-assets");
await mkdir(cache, { recursive: true });
async function download(url, file, expectedHash) {
  if (!(await stat(file).catch(() => undefined))?.isFile()) {
    const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body || !response.url.startsWith("https://")) throw new Error("官方组件下载失败");
    const temporary = file + ".partial-" + randomUUID();
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx" }));
    if (expectedHash && await sha256(temporary) !== expectedHash) throw new Error("组件官方校验和不符");
    await rename(temporary, file);
  }
  const hash = await sha256(file);
  if (expectedHash && hash !== expectedHash) throw new Error("缓存与官方校验和不符");
  return { url, sha256: hash };
}
const result = [];
for (const arch of ["arm64", "x64"]) {
  const nodeFile = join(cache, `node-darwin-${arch}.tar.gz`);
  const nodeSource = await download(`https://nodejs.org/dist/v${NODE_MAC.version}/node-v${NODE_MAC.version}-darwin-${arch}.tar.gz`, nodeFile, NODE_MAC[arch]);
  const nodeEntries = readTarGzip(await readFile(nodeFile));
  const node = nodeEntries.find(e => e.path.endsWith("/bin/node"));
  const nodeLicense = nodeEntries.find(e => e.path.endsWith("/LICENSE"));
  if (!node || !nodeLicense?.data.length) throw new Error("Node运行时或许可缺失");
  const nodeBinary = inspectMachO(node.data, arch);
  console.log(`Node ${arch} 已检查`);
  const chromiumFile = join(cache, `chromium-headless-${arch}.zip`);
  const chromiumSource = await download(`https://cdn.playwright.dev/builds/cft/156.0.8078.4/mac-${arch}/chrome-headless-shell-mac-${arch}.zip`, chromiumFile);
  const zip = await JSZip.loadAsync(await readFile(chromiumFile), { checkCRC32: true });
  const paths = Object.keys(zip.files);
  const enginePath = paths.find(p => p.endsWith("/chrome-headless-shell"));
  const licensePaths = paths.filter(p => /license|notice|credits|copying/i.test(p));
  if (!enginePath || !licensePaths.length) throw new Error("Chromium引擎或同包许可缺失");
  const chromiumBinary = inspectMachO(await zip.file(enginePath).async("nodebuffer"), arch);
  const licenses = [];
  for (const path of licensePaths) {
    const data = await zip.file(path).async("nodebuffer");
    licenses.push({ path, bytes: data.length });
    const destination = join(cache, arch, path); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, data);
  }
  result.push({ arch, nodeSource, nodeBinary, chromiumSource, chromiumBinary, enginePath, licenses, entries: paths.length });
  console.log(JSON.stringify(result.at(-1), null, 2));
}
await writeFile(join(cache, "inspection.json"), JSON.stringify(result, null, 2) + "\n");
