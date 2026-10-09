import { createHash, verify } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTarGzip, inspectMachO } from "./mac-prebuilt-inspection.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(root, "tmp/mac-keychain-alternatives");
const specs = [
  ["koffi", "3.3.2"], ["@koromix/koffi-darwin-arm64", "3.3.2"],
  ["@koromix/koffi-darwin-x64", "3.3.2"], ["just-secrets", "0.0.2"]
];
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`公开组件元数据读取失败 ${response.status}`);
  return response.json();
}
const { keys } = await json("https://registry.npmjs.org/-/npm/v1/keys");
const results = [];
for (const [name, version] of specs) {
  const metadata = await json(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`);
  if (metadata.name !== name || metadata.version !== version || new URL(metadata.dist.tarball).origin !== "https://registry.npmjs.org") throw new Error("组件身份或来源不符");
  const response = await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error("组件下载失败");
  const data = Buffer.from(await response.arrayBuffer());
  const integrity = "sha512-" + createHash("sha512").update(data).digest("base64");
  if (integrity !== metadata.dist.integrity) throw new Error("组件完整性不符");
  const registrySignatureVerified = metadata.dist.signatures?.some(signature => {
    const key = keys.find(key => key.keyid === signature.keyid);
    if (!key || key.expires && Date.parse(key.expires) <= Date.now()) return false;
    return verify("sha256", Buffer.from(`${name}@${version}:${integrity}`), { key: Buffer.from(key.key, "base64"), format: "der", type: "spki" }, Buffer.from(signature.sig, "base64"));
  });
  if (!registrySignatureVerified) throw new Error("注册表签名验证失败");
  const entries = readTarGzip(data); const destination = join(cacheRoot, encodeURIComponent(name));
  await mkdir(destination, { recursive: true }); await writeFile(join(destination, "upstream.tgz"), data);
  for (const entry of entries.filter(entry => entry.type === "0")) {
    const file = join(destination, entry.path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, entry.data);
  }
  const binaries = entries.filter(entry => entry.path.endsWith(".node")).map(entry => ({ path: entry.path, ...inspectMachO(entry.data, name.endsWith("arm64") ? "arm64" : "x64") }));
  const result = { name, version, gitHead: metadata.gitHead, url: metadata.dist.tarball, integrity, registrySignatureVerified, sha256: createHash("sha256").update(data).digest("hex"), license: metadata.license, files: entries.map(entry => entry.path), binaries };
  results.push(result); console.log(JSON.stringify(result, null, 2));
}
await writeFile(join(cacheRoot, "inspection.json"), JSON.stringify(results, null, 2) + "\n");
