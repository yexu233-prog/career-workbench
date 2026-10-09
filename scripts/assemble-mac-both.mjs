import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_MAC, sha256 } from "./mac-package-policy.mjs";
import { inspectMachO, readTarGzip } from "./mac-prebuilt-inspection.mjs";
import { readZipEntries, virtualManifest, createVirtualZip } from "./mac-virtual-package.mjs";
import { createLicenses } from "./release-metadata.mjs";
import { assertPublicRelease } from "./public-release-policy.mjs";
import { verifyAcceptedArm64, macSupportStatus } from "./mac-public-release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "tmp/mac-prebuilt-assets");
const components = join(root, "tmp/mac-keychain-alternatives");
const expectedKoffi = { koffi: "1c5189a71bab92a3b429e82456d10254ce1a1528a1c49f87f4e93ce944426cb0", arm64: "7b1bb9a4c32b8ff5524250bddc84783106832130fced60a7bb58468ed809db29", x64: "d5d700cf15b763ab90b7a1c32136446bf53defb6584ced841fcf329ccbad6876" };
const expectedChromium = { arm64: "94e4337b70cbc5638f0935fbc46b9f242bc7416f657e3fbe924baf348404b53d", x64: "8a9e4a32ba5b1a796f8b16d01896e355cf6662544d9743296394fd999d782331" };
function run(args) { execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" }); }
async function verifyHash(path, expected) { if (await sha256(path) !== expected) throw new Error("预编译组件与已核对固定摘要不符"); }
async function tree(directory, prefix) {
  const entries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name); const target = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) entries.push(...await tree(path, target));
    else if (entry.isFile()) entries.push({ path: target, data: await readFile(path), mode: 0o644 });
    else throw new Error("源码运行资源含未预期的特殊文件");
  }
  return entries;
}
function command(architecture, file, action = "") {
  return `#!/bin/zsh\nset -u\ncd -- "\${0:A:h}" || exit 1\nif [[ "$(/usr/bin/uname -m)" != "${architecture === "arm64" ? "arm64" : "x86_64"}" ]]; then\n  print '此包与当前Mac芯片不匹配，请使用正确架构的测试包。'\n  exit 1\nfi\n/usr/bin/env -i HOME="$HOME" USER="\${USER:-}" LOGNAME="\${LOGNAME:-}" TMPDIR="\${TMPDIR:-/tmp}" LANG="\${LANG:-zh_CN.UTF-8}" PATH='/usr/bin:/bin:/usr/sbin:/sbin' ./runtime/node/node ./native/macos/${file} ${action}\nresult=$?\nif [[ $result -ne 0 ]]; then\n  print '未完成。请保留上方提示；不要关闭系统安全保护。'\nfi\nprint '按回车关闭此窗口。'\nread -r reply\nexit $result\n`;
}
async function sourceIdentity() {
  const args = { cwd: root, encoding: "utf8", windowsHide: true };
  const commit = execFileSync("git", ["rev-parse", "HEAD"], args).trim();
  const branch = execFileSync("git", ["branch", "--show-current"], args).trim();
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], args).split("\0").filter(Boolean).sort();
  const hash = createHash("sha256"); const files = [];
  for (const name of names) { const value = await sha256(join(root, name)); hash.update(name + "\0" + value + "\n"); files.push({ path: name, sha256: value }); }
  const dirty = Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], args).trim());
  return { commit, branch, workingTreeDirty: dirty, sourceSha256: hash.digest("hex"), files };
}
async function main() {
  if (process.platform !== "win32" || process.arch !== "x64" || !process.versions.node.startsWith("24.")) throw new Error("本入口需要Windows x64上的Node24");
  const flags = process.argv.slice(2); let releaseTag; let referenceArm64;
  while (flags.length) {
    const flag = flags.shift(); const value = flags.shift();
    if (!value || value.startsWith("--")) throw new Error("组装参数缺少值");
    if (flag === "--public" && !releaseTag) releaseTag = value;
    else if (flag === "--reference-arm64" && !referenceArm64) referenceArm64 = resolve(value);
    else throw new Error("无效或重复组装参数");
  }
  if (referenceArm64 && !releaseTag) throw new Error("参考验收只用于公开重建流程");
  if (releaseTag) {
    if (!referenceArm64) throw new Error("公开Mac重建须提供 --reference-arm64 已验收ZIP");
    await assertPublicRelease(root, releaseTag);
  }
  const playwright = JSON.parse(await readFile(join(root, "node_modules/playwright-core/package.json"), "utf8"));
  const browser = JSON.parse(await readFile(join(root, "node_modules/playwright-core/browsers.json"), "utf8")).browsers.find(b => b.name === "chromium-headless-shell");
  if (playwright.version !== "1.64.0" || browser?.revision !== "1248" || browser?.browserVersion !== "156.0.8078.4") throw new Error("PDF引擎版本与已核对组件不匹配");
  // These are build-machine commands only. Product packages contain no installer.
  const npmCli = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  run([npmCli, "run", "check"]); run([npmCli, "audit", "--audit-level=high"]);
  const batch = join(root, "release", "mac-windows-assembly-" + randomUUID()); await mkdir(batch, { recursive: true });
  const staging = join(batch, "build-resources"); await mkdir(staging);
  run([join(root, "scripts/bundle-service.mjs"), join(staging, "server.mjs")]);
  const nodeArm = join(cache, "node-darwin-arm64.tar.gz"); await verifyHash(nodeArm, NODE_MAC.arm64);
  const nodeLicense = readTarGzip(await readFile(nodeArm)).find(e => e.path.endsWith("/LICENSE"));
  await mkdir(join(staging, "node-license")); await writeFile(join(staging, "node-license/LICENSE"), nodeLicense.data);
  const licenseResult = await createLicenses(staging, join(staging, "node-license/node"));
  if (licenseResult.missingLicenseText.length) throw new Error("生产依赖仍有许可原文缺口");
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  if (releaseTag) await assertPublicRelease(root, releaseTag);
  const source = await sourceIdentity(); const results = [];
  await verifyHash(join(components, "koffi/upstream.tgz"), expectedKoffi.koffi);
  const koffiEntries = readTarGzip(await readFile(join(components, "koffi/upstream.tgz")));
  for (const arch of ["arm64", "x64"]) {
    const entries = []; const add = (path, data, mode = 0o644) => entries.push({ path, data: Buffer.isBuffer(data) ? data : Buffer.from(data), mode });
    const name = `career-workbench-${version}-mac-${arch}`; const packageId = randomUUID();
    const nodeArchive = join(cache, `node-darwin-${arch}.tar.gz`); await verifyHash(nodeArchive, NODE_MAC[arch]);
    const nodeEntries = readTarGzip(await readFile(nodeArchive)); const node = nodeEntries.find(e => e.path.endsWith("/bin/node"));
    inspectMachO(node.data, arch); add("runtime/node/node", node.data, 0o755);
    add("runtime/node/LICENSE", nodeEntries.find(e => e.path.endsWith("/LICENSE")).data);
    const engineArchive = join(cache, `chromium-headless-${arch}.zip`); await verifyHash(engineArchive, expectedChromium[arch]);
    const engineEntries = await readZipEntries(await readFile(engineArchive));
    const enginePath = `runtime/chromium/chrome-headless-shell-mac-${arch}/chrome-headless-shell`;
    for (const entry of engineEntries) {
      if (entry.path.endsWith("/chrome-headless-shell") || entry.path.endsWith(".dylib") || entry.data.length >= 4 && entry.data.readUInt32LE(0) === 0xfeedfacf) inspectMachO(entry.data, arch);
      entries.push({ ...entry, path: "runtime/chromium/" + entry.path });
    }
    const engineLicense = engineEntries.find(e => e.path.endsWith("/LICENSE.headless_shell"));
    if (!engineLicense || engineLicense.data.length < 10000) throw new Error("缺少Chromium同版本完整声明");
    add("licenses/chromium/LICENSE.headless_shell", engineLicense.data);
    const platformName = `@koromix/koffi-darwin-${arch}`; const bindingArchive = join(components, encodeURIComponent(platformName), "upstream.tgz");
    await verifyHash(bindingArchive, expectedKoffi[arch]);
    for (const entry of readTarGzip(await readFile(bindingArchive))) {
      if (entry.path.endsWith(".node")) inspectMachO(entry.data, arch);
      add(`node_modules/${platformName}/${entry.path.slice(8)}`, entry.data);
    }
    const runtimeFiles = ["package.json", "index.cjs", "index.js", "indirect.cjs", "indirect.js", "index.d.ts", "src/koffi/index.cjs", "src/koffi/index.js", "src/koffi/indirect.cjs", "src/koffi/indirect.js", "src/koffi/src/static.cjs", "src/koffi/src/static.js"];
    for (const path of runtimeFiles) {
      const entry = koffiEntries.find(e => e.path === "package/" + path); if (!entry) throw new Error("Koffi运行资源缺失");
      if (path === "package.json") {
        const pkg = JSON.parse(entry.data.toString()); delete pkg.scripts; delete pkg.cnoke;
        pkg.optionalDependencies = { [platformName]: "3.3.2" }; add("node_modules/koffi/package.json", JSON.stringify(pkg, null, 2));
      } else add("node_modules/koffi/" + path, entry.data);
    }
    for (const path of ["LICENSE.txt", "vendor/node-addon-api/LICENSE.md", "vendor/node-api-headers/LICENSE"]) {
      const entry = koffiEntries.find(e => e.path === "package/" + path); if (!entry?.data.length) throw new Error("Koffi原生依赖许可证缺失");
      add("licenses/koffi/" + path, entry.data);
    }
    entries.push(...await tree(join(root, "third_party/licenses/koffi/3.3.2"), "licenses/koffi/supplemental"));
    add("licenses/Mac组件说明.md", "# Mac运行组件与许可\n\nNode官方24.19.0；Koffi3.3.2及其node-addon-api/node-api-headers采用各自MIT，原文在koffi目录，条件依赖和Unicode数据声明见supplemental；Playwright1.64.0及配套Chrome Headless Shell156.0.8078.4保留同包完整声明；字体采用Noto OFL。README中的npm清单是本机构建生产依赖的许可集合，可能多于Mac运行文件。Apple系统框架由设备提供，不随包分发。\n");
    add("app/server.mjs", await readFile(join(staging, "server.mjs")));
    entries.push(...await tree(join(root, "apps/web/dist"), "web"), ...await tree(join(staging, "licenses"), "licenses"), ...await tree(join(root, "node_modules/playwright-core"), "node_modules/playwright-core"));
    add("LICENSE", await readFile(join(root, "LICENSE")));
    add("licenses/Playwright-ThirdPartyNotices.txt", await readFile(join(root, "node_modules/playwright-core/ThirdPartyNotices.txt")));
    for (const path of ["NotoSansCJKsc-Regular.otf", "OFL.txt", "README.md"]) add("assets/fonts/" + path, await readFile(join(root, "assets/fonts", path)));
    for (const path of ["keychain-helper.mjs", "keychain-backend.mjs", "keychain-operations.mjs", "package-runtime.mjs", "controller.mjs", "launcher.mjs", "self-check.mjs"]) add("native/macos/" + path, await readFile(join(root, "native/macos", path)));
    add("启动求职工作台.command", command(arch, "launcher.mjs", "start"), 0o755);
    add("停止求职工作台.command", command(arch, "launcher.mjs", "stop"), 0o755);
    add("运行自检.command", command(arch, "self-check.mjs"), 0o755);
    add("使用说明.md", await readFile(join(root, "docs/Mac测试版使用说明.md")));
    add("Mac验收与发布范围-20261009.md", await readFile(join(root, "docs/Mac验收与发布范围-20261009.md")));
    add("发行说明.md", await readFile(join(root, `docs/发行说明-${version}.md`)));
    const acceptance = releaseTag && arch === "arm64" ? await verifyAcceptedArm64(entries, referenceArm64, version) : undefined;
    const support = macSupportStatus(arch, Boolean(acceptance));
    add("验收状态.md", `# ${support.label}\n\nWindows静态检查通过。${acceptance ? "用户已确认参考ZIP实机验收通过；本次运行文件比对通过，只有显示版本号及相应构建引用变化。本次新ZIP未再次在Mac执行，不把参考确认冒称为本ZIP自检报告。" : "本ZIP未完成对应架构的Mac实机验收。"}\n\n未签名、未Apple公证；哈希不等于签名。详见Mac验收与发布范围及使用说明。\n`);
    add("source-build.json", JSON.stringify(source, null, 2));
    const metadata = { schemaVersion: 1, packageId, appVersion: version, ...(releaseTag ? { releaseTag, releaseChannel: "public-preview" } : {}), gitCommit: source.commit, workingTreeDirty: source.workingTreeDirty, platform: "darwin", architecture: arch, minimumMacOS: "14.0", nodeVersion: NODE_MAC.version, keychainBackend: "koffi-file-keychain", koffiVersion: "3.3.2", playwrightVersion: "1.64.0", chromiumVersion: browser.browserVersion, chromiumRevision: browser.revision, chromiumExecutable: enginePath, builtAt: new Date().toISOString(), sourceSha256: source.sourceSha256, nodeSourceSha256: NODE_MAC[arch], chromiumSourceSha256: expectedChromium[arch], koffiSourceSha256: expectedKoffi.koffi, bindingSourceSha256: expectedKoffi[arch], supportStatus: support.supportStatus, ...(acceptance ? { acceptanceReference: acceptance } : {}), validation: { windowsStatic: "passed", macRuntime: support.macRuntime, human: support.human }, signedProduct: false, notarized: false };
    add("version.json", JSON.stringify(metadata, null, 2));
    const byName = new Map(entries.map(entry => [entry.path, entry]));
    for (const path of ["app/server.mjs", "web/index.html", "runtime/node/node", enginePath, "native/macos/keychain-helper.mjs", "assets/fonts/NotoSansCJKsc-Regular.otf", "licenses/koffi/LICENSE.txt", "licenses/chromium/LICENSE.headless_shell", "启动求职工作台.command", "停止求职工作台.command", "运行自检.command"]) if (!byName.get(path)?.data.length) throw new Error("必要运行组件缺失或为空");
    for (const path of ["runtime/node/node", enginePath, "启动求职工作台.command", "停止求职工作台.command", "运行自检.command"]) if (!(byName.get(path).mode & 0o111)) throw new Error("运行组件缺少UNIX执行位");
    for (const match of byName.get("web/index.html").data.toString().matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)) if (!byName.get("web" + match[1])?.data.length) throw new Error("网页引用资源缺失");
    for (const entry of entries) if (/\.(?:exe|dll)$/i.test(entry.path) || /(^|\/)\.git\//.test(entry.path)) throw new Error("Mac包混入Windows或仓库组件");
    const manifest = virtualManifest(entries); add("manifest.json", JSON.stringify(manifest, null, 2));
    const partial = join(batch, name + ".zip.partial");
    await pipeline(createVirtualZip(entries, name).generateNodeStream({ type: "nodebuffer", platform: "UNIX", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } }), createWriteStream(partial, { flags: "wx" }));
    const restored = (await readZipEntries(await readFile(partial))).map(e => ({ ...e, path: e.path.slice(name.length + 1) }));
    if (JSON.stringify(virtualManifest(restored)) !== JSON.stringify(manifest)) throw new Error("最终ZIP文件、模式或链接往返校验失败");
    const zipFile = join(batch, name + ".zip"); await rename(partial, zipFile);
    const hash = await sha256(zipFile); await writeFile(zipFile + ".sha256", `${hash}  ${name}.zip\n`, { flag: "wx" });
    if (await sha256(zipFile) !== hash) throw new Error("ZIP最终哈希复核失败");
    results.push({ architecture: arch, zipFile, sha256: hash, packageId, fileCount: manifest.files.length, supportStatus: support.supportStatus });
    console.log(`${arch} ${support.label} ZIP已生成：${zipFile}`);
  }
  await writeFile(join(batch, "组装结果.json"), JSON.stringify({ results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
