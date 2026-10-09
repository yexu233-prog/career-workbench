import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, cp, copyFile, readFile, writeFile, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAC_TARGETS, NODE_MAC, assertMacBuildHost, assertBinaryArchitecture, sha256, createMacManifest } from "./mac-package-policy.mjs";
import { createLicenses } from "./release-metadata.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}
function text(command, args) { return run(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function nonempty(path) { const info = await stat(path); if (!info.isFile() || !info.size) throw new Error("Mac包所需文件缺失或为空"); }
async function download(url, file) {
  // Only fixed official HTTPS URLs; no TLS bypass or shell evaluation.
  await new Promise((resolveTask, reject) => {
    const child = spawn("/usr/bin/curl", ["--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2", "--max-time", "1800", "--output", file, url], { stdio: "inherit" });
    child.once("error", reject); child.once("close", (code) => code === 0 ? resolveTask() : reject(new Error("官方组件下载失败；不会生成可交付包")));
  });
}

async function main() {
  assertMacBuildHost();
  if (!process.versions.node.startsWith("24.")) throw new Error("Mac构建须使用Node 24");
  if (Number(text("/usr/bin/sw_vers", ["--productVersion"]).split(".")[0]) < 14) throw new Error("本批目标要求macOS 14或以上");
  text("/usr/bin/xcode-select", ["-p"]); // Stops before invoking xcrun if developer tools are not configured.
  const sdk = text("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
  text("/usr/bin/xcrun", ["--find", "swiftc"]); // Never installs developer tools automatically.
  run("npm", ["run", "check"]);
  run("npm", ["audit", "--audit-level=high"]);
  const playwright = JSON.parse(await readFile(join(root, "node_modules/playwright-core/package.json"), "utf8"));
  const browsers = JSON.parse(await readFile(join(root, "node_modules/playwright-core/browsers.json"), "utf8"));
  if (playwright.version !== "1.64.0") throw new Error("Playwright固定版本不匹配");
  const chromium = browsers.browsers.find((item) => item.name === "chromium");
  if (!chromium || chromium.revision !== "1248" || chromium.browserVersion !== "156.0.8078.4") throw new Error("Chromium配套版本不匹配");
  const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const batch = join(root, "release", `mac-build-${randomUUID()}`);
  await mkdir(batch, { recursive: true });
  const results = [];
  for (const arch of MAC_TARGETS) {
    const name = `career-workbench-${version}-mac-${arch}`;
    const packageRoot = join(batch, name); const app = join(packageRoot, "求职工作台.app");
    const contents = join(app, "Contents"); const resources = join(contents, "Resources");
    const assets = join(batch, `.assets-${arch}`);
    await mkdir(assets); await mkdir(join(contents, "MacOS"), { recursive: true });
    for (const folder of ["app", "runtime/node", "runtime/chromium", "native", "assets/fonts", "node_modules"]) await mkdir(join(resources, folder), { recursive: true });

    const archiveName = `node-v${NODE_MAC.version}-darwin-${arch}.tar.gz`;
    const nodeArchive = join(assets, archiveName);
    const nodeUrl = `https://nodejs.org/dist/v${NODE_MAC.version}/${archiveName}`;
    await download(nodeUrl, nodeArchive);
    if (await sha256(nodeArchive) !== NODE_MAC[arch]) throw new Error("Node归档与已复核的官方SHA-256不符，停止构建");
    run("/usr/bin/tar", ["-xzf", nodeArchive, "-C", assets]);
    const nodeSource = join(assets, `node-v${NODE_MAC.version}-darwin-${arch}`);
    const node = join(resources, "runtime/node/node");
    await copyFile(join(nodeSource, "bin/node"), node);
    await copyFile(join(nodeSource, "LICENSE"), join(resources, "runtime/node/LICENSE"));

    const chromiumArchive = join(assets, "chromium.zip");
    const chromiumUrl = `https://cdn.playwright.dev/builds/cft/${chromium.browserVersion}/mac-${arch}/chrome-mac-${arch}.zip`;
    await download(chromiumUrl, chromiumArchive);
    run("/usr/bin/ditto", ["-x", "-k", chromiumArchive, join(resources, "runtime/chromium")]);
    const engineRelative = `runtime/chromium/chrome-mac-${arch}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
    const engine = join(resources, engineRelative);
    await nonempty(engine);

    run(process.execPath, [join(root, "scripts/bundle-service.mjs"), join(resources, "app/server.mjs")]);
    await cp(join(root, "apps/web/dist"), join(resources, "web"), { recursive: true });
    await cp(join(root, "node_modules/playwright-core"), join(resources, "node_modules/playwright-core"), { recursive: true, verbatimSymlinks: true });
    for (const file of ["NotoSansCJKsc-Regular.otf", "OFL.txt", "README.md"]) await copyFile(join(root, "assets/fonts", file), join(resources, "assets/fonts", file));

    const helper = join(resources, "native/keychain-helper"); const launcher = join(contents, "MacOS/Launcher");
    const target = `${arch === "x64" ? "x86_64" : "arm64"}-apple-macos14.0`;
    for (const [source, output, framework] of [["KeychainHelper.swift", helper, "Security"], ["Launcher.swift", launcher, "AppKit"]]) {
      run("/usr/bin/xcrun", ["swiftc", "-swift-version", "5", "-O", "-sdk", sdk, "-target", target, "-framework", framework, join(root, "native/macos", source), "-o", output]);
    }
    for (const file of [node, engine, helper, launcher]) {
      assertBinaryArchitecture(text("/usr/bin/lipo", ["-archs", file]), arch);
      run("/bin/chmod", ["755", file]);
    }
    run("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", "local.career-workbench.keychain-helper", "--timestamp=none", helper]);
    await createLicenses(resources, node);
    await mkdir(join(resources, "licenses/chromium"), { recursive: true });
    await writeFile(join(resources, "licenses/chromium/待核验.txt"), "Chromium完整第三方许可将在运行自检时从随包引擎的chrome://credits导出。未取得原文不得生成可交付ZIP。\n");
    await copyFile(join(root, "node_modules/playwright-core/ThirdPartyNotices.txt"), join(resources, "licenses/Playwright-ThirdPartyNotices.txt"));
    await copyFile(join(root, "docs/Mac测试版使用说明.md"), join(packageRoot, "使用说明.md"));
    await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Launcher</string><key>CFBundleIdentifier</key><string>local.career-workbench.launcher.${arch}</string><key>CFBundleName</key><string>求职工作台</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/></dict></plist>\n`);
    const metadata = { schemaVersion: 1, appVersion: version, architecture: arch, platform: "darwin", nodeVersion: NODE_MAC.version, playwrightVersion: playwright.version, chromiumVersion: chromium.browserVersion, chromiumRevision: chromium.revision, chromiumExecutable: engineRelative, builtAt: new Date().toISOString(), validation: "pending", licenseStatus: "pending-chromium-credits", lockfileSha256: await sha256(join(root, "package-lock.json")), launcherSourceSha256: await sha256(join(root, "native/macos/Launcher.swift")), nodeSource: { url: nodeUrl, sha256: NODE_MAC[arch] }, chromiumSource: { url: chromiumUrl, downloadedSha256: await sha256(chromiumArchive) } };
    await writeFile(join(resources, "version.json"), JSON.stringify(metadata, null, 2) + "\n");
    await writeFile(join(packageRoot, "验收状态.md"), `# 待运行验证\n\n架构：${arch}。当前仅完成构建和架构检查；未通过对应运行环境的服务/PDF冒烟，不能标记为可交付或实机验收通过。\n`);
    run("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", app]);
    run("/usr/bin/codesign", ["--verify", "--strict", app]);
    await createMacManifest(packageRoot);
    results.push({ architecture: arch, packageRoot, state: "built-pending-runtime-check", nativeBuildHost: process.arch === arch });
  }
  // Both architectures are built before smoke tests; one failed smoke never relabels the other.
  for (const result of results) {
    if (result.architecture !== process.arch) continue; // No automatic Rosetta installation.
    try { run(process.execPath, [join(root, "scripts/verify-mac-package.mjs"), result.packageRoot]); result.state = "automatic-smoke-passed-human-pending"; }
    catch { result.state = "automatic-smoke-failed"; }
  }
  await writeFile(join(batch, "构建结果.json"), JSON.stringify({ builtAt: new Date().toISOString(), results }, null, 2) + "\n");
  console.log(`两架构构建目录：${batch}`);
  console.log("非本机架构仅构建，未记为运行通过；使用对应Mac运行verify-mac-package.mjs后才生成ZIP。没有推送或上传。");
  if (results.some((result) => result.state === "automatic-smoke-failed")) process.exitCode = 1;
}
main().catch(() => { console.error("Mac双架构构建未完成：请检查官方下载、Swift工具链、许可证、组件完整性及类型/测试输出。未覆盖旧包，不生成失败包ZIP。"); process.exitCode = 1; });
