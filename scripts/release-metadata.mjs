import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicRelease } from "./public-release-policy.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fileName = fileURLToPath(import.meta.url);
const slash = (value) => value.split(sep).join("/");
const isInside = (root, target) => target === root || target.startsWith(root + sep);

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function allFiles(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await allFiles(target, base));
    else if (entry.isFile()) files.push(slash(relative(base, target)));
    else throw new Error(`发布包不允许符号链接或特殊文件：${target}`);
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

export async function createFileManifest(packageRoot) {
  const files = (await allFiles(packageRoot)).filter((name) => name !== "manifest.json");
  const entries = [];
  for (const name of files) {
    const file = join(packageRoot, ...name.split("/"));
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error(`发布包文件缺失或为空：${name}`);
    entries.push({ path: name, bytes: info.size, sha256: await sha256(file) });
  }
  const manifest = {
    schemaVersion: 1,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    files: entries
  };
  await writeFile(join(packageRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export async function verifyFileManifest(packageRoot) {
  const manifest = JSON.parse(await readFile(join(packageRoot, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length) {
    throw new Error("发布包文件清单格式无效");
  }
  const actual = (await allFiles(packageRoot)).filter((name) => name !== "manifest.json");
  const listed = manifest.files.map((entry) => entry.path);
  if (new Set(listed).size !== listed.length || JSON.stringify(actual) !== JSON.stringify([...listed].sort((a, b) => a.localeCompare(b, "en")))) {
    throw new Error("发布包文件清单与实际文件不一致");
  }
  let total = 0;
  for (const entry of manifest.files) {
    if (typeof entry.path !== "string" || entry.path.startsWith("/") || entry.path.split("/").some((part) => part === ".." || part === "." || !part)) {
      throw new Error("发布包文件清单含不安全路径");
    }
    const file = resolve(packageRoot, ...entry.path.split("/"));
    if (!isInside(resolve(packageRoot), file)) throw new Error("发布包文件清单越界");
    const info = await stat(file);
    if (info.size !== entry.bytes || await sha256(file) !== entry.sha256) throw new Error(`发布包文件校验失败：${entry.path}`);
    total += info.size;
  }
  if (total !== manifest.totalBytes) throw new Error("发布包文件总大小不一致");
  return manifest;
}

function sourceNumber(file, pattern, label) {
  return readFile(file, "utf8").then((text) => {
    const match = pattern.exec(text);
    if (!match) throw new Error(`无法从源码读取${label}`);
    return Number(match[1]);
  });
}

function gitValue(args) {
  try { return execFileSync("git", args, { cwd: projectRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
}

async function installedRuntimePackages() {
  const lock = JSON.parse(await readFile(join(projectRoot, "package-lock.json"), "utf8"));
  const result = [];
  for (const [lockPath, entry] of Object.entries(lock.packages ?? {})) {
    if (!lockPath.includes("node_modules/") || entry.dev || !entry.version || lockPath.includes("@career-workbench/")) continue;
    const packageDir = resolve(projectRoot, ...lockPath.split("/"));
    if (!isInside(join(projectRoot, "node_modules"), packageDir)) throw new Error(`依赖路径越界：${lockPath}`);
    const packageFile = join(packageDir, "package.json");
    const info = await stat(packageFile).catch(() => undefined);
    if (!info?.isFile()) {
      if (entry.optional) continue; // Other operating system's optional binary.
      throw new Error(`运行依赖未安装：${lockPath}`);
    }
    const installed = JSON.parse(await readFile(packageFile, "utf8"));
    if (installed.version !== entry.version || !installed.license) throw new Error(`运行依赖版本或许可证元数据异常：${lockPath}`);
    result.push({ name: installed.name, version: installed.version, license: installed.license, repository: typeof installed.repository === "string" ? installed.repository : installed.repository?.url ?? "", directory: packageDir });
  }
  return result.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"));
}

async function createLicenses(packageRoot, nodeSource) {
  const licenseRoot = join(packageRoot, "licenses");
  const projectLicense = await readFile(join(projectRoot, "LICENSE"), "utf8");
  if (!projectLicense.startsWith("MIT License") || !projectLicense.includes("Copyright (c) 2026 叶许")) throw new Error("项目 MIT 许可证与确认的署名不一致");
  await copyFile(join(projectRoot, "LICENSE"), join(packageRoot, "LICENSE"));
  await mkdir(join(licenseRoot, "node"), { recursive: true });
  await mkdir(join(licenseRoot, "fonts"), { recursive: true });
  const nodeLicense = join(dirname(nodeSource), "LICENSE");
  if (!(await stat(nodeLicense).catch(() => undefined))?.isFile()) throw new Error(`随包 Node 缺少许可证原文：${nodeLicense}`);
  await copyFile(nodeLicense, join(licenseRoot, "node", "LICENSE.txt"));
  await copyFile(join(projectRoot, "assets", "fonts", "OFL.txt"), join(licenseRoot, "fonts", "NotoSansCJKsc-OFL.txt"));

  const packages = await installedRuntimePackages();
  const rows = [];
  const missing = [];
  for (const item of packages) {
    const destination = join(licenseRoot, "npm", encodeURIComponent(item.name), item.version);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "PACKAGE.txt"), `组件：${item.name}\n版本：${item.version}\n声明的许可证：${item.license}\n上游仓库：${item.repository || "未提供"}\n`);
    const names = (await readdir(item.directory)).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    const copied = [];
    for (const name of names) {
      const source = join(item.directory, name);
      if (!(await stat(source)).isFile()) continue;
      await copyFile(source, join(destination, name));
      copied.push(slash(relative(licenseRoot, join(destination, name))));
    }
    let sourceNote = "";
    if (!copied.some((name) => /\/(licen[cs]e|copying)(\.|$)/i.test(name))) {
      if (item.name === "@napi-rs/canvas-win32-x64-msvc" && item.version === "1.0.6") {
        const parentLicense = join(projectRoot, "node_modules", "@napi-rs", "canvas", "LICENSE");
        if (!(await stat(parentLicense).catch(() => undefined))?.isFile()) throw new Error("canvas 平台包缺少同项目许可证原文");
        await copyFile(parentLicense, join(destination, "LICENSE.from-parent.txt"));
        copied.push(slash(relative(licenseRoot, join(destination, "LICENSE.from-parent.txt"))));
        sourceNote = "同上游 @napi-rs/canvas 安装包";
      } else if (item.name === "abstract-logging" && item.version === "2.0.1") {
        const source = join(projectRoot, "third_party", "licenses", item.name, item.version);
        await copyFile(join(source, "LICENSE.txt"), join(destination, "LICENSE.from-upstream.txt"));
        await copyFile(join(source, "SOURCE.md"), join(destination, "SOURCE.md"));
        copied.push(slash(relative(licenseRoot, join(destination, "LICENSE.from-upstream.txt"))));
        sourceNote = "上游 README 所链接作者许可页，来源见 SOURCE.md";
      } else if ((item.name === "hash.js" && item.version === "1.1.7") || (item.name === "isarray" && item.version === "1.0.0")) {
        const readme = await readFile(join(item.directory, "README.md"), "utf8");
        const marker = item.name === "hash.js" ? /#### LICENSE\s*\n/i : /## License\s*\n/i;
        const start = marker.exec(readme);
        const text = start ? readme.slice(start.index + start[0].length).trim().replaceAll("&lt;", "<").replaceAll("&gt;", ">") : "";
        if (!text.includes("Permission is hereby granted") || !text.includes("THE SOFTWARE IS PROVIDED")) throw new Error(`${item.name} 的 README 未包含完整许可证文本`);
        await writeFile(join(destination, "LICENSE.from-README.txt"), text + "\n");
        copied.push(slash(relative(licenseRoot, join(destination, "LICENSE.from-README.txt"))));
        sourceNote = "该版本安装包 README 内嵌完整许可文本";
      }
    }
    if (!copied.some((name) => /\/(licen[cs]e|copying)(\.|$)/i.test(name))) missing.push(`${item.name}@${item.version}`);
    if (item.name === "dingbat-to-unicode") {
      if (item.version !== "1.0.2" || !copied.some((name) => name.endsWith("/LICENSE"))) throw new Error("dingbat-to-unicode 必须使用已核对且附带 LICENSE 的 1.0.2");
      const notice = await readFile(join(item.directory, "LICENSE"), "utf8");
      if (!notice.includes("Copyright (c) 2021, Michael Williamson") || !notice.includes("THIS SOFTWARE IS PROVIDED")) throw new Error("dingbat-to-unicode 上游许可声明不完整");
    }
    rows.push(`| ${item.name} | ${item.version} | ${String(item.license).replaceAll("|", "\\|")} | ${copied.length ? copied.map((name) => `\`${name}\``).join("、") + (sourceNote ? `（${sourceNote}）` : "") : "未随安装包附带原文，需人工复核"} |`);
  }
  const catalog = [
    "# 随包第三方组件与许可证", "",
    "本项目源码采用 MIT，著作权人：叶许；完整原文见包根目录 `LICENSE`。第三方组件保留各自许可，不因本项目采用 MIT 而改变。", "",
    "本目录集中保存随包 Node.js、Noto Sans CJK SC 字体及本机构建中安装的生产依赖许可证资料。清单按锁文件和本机构建环境生成；不包含开发工具依赖。此目录不等于本项目自身的开源许可证，也不代替发布前的人工许可审查。", "",
    "- Node.js：`node/LICENSE.txt`", "- 字体：`fonts/NotoSansCJKsc-OFL.txt`", `- 生产依赖：${packages.length} 项`,
    `- 未随 npm 安装包附带许可证原文：${missing.length} 项（下表已标明，公开发布前需复核上游原文）`, "",
    "| 组件 | 版本 | 声明的许可证 | 随包文件 |", "| --- | --- | --- | --- |", ...rows, ""
  ];
  await writeFile(join(licenseRoot, "README.md"), catalog.join("\n"));
  return { packageCount: packages.length, missingLicenseText: missing };
}

export async function generateReleaseMetadata(packageRoot, nodeSource, releaseTag) {
  if (releaseTag !== undefined) await assertPublicRelease(projectRoot, releaseTag);
  const root = resolve(packageRoot);
  const packageName = basename(root);
  const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
  if (packageJson.license !== "MIT") throw new Error("项目许可证元数据应为 MIT");
  const shared = await readFile(join(projectRoot, "packages", "shared", "src", "index.ts"), "utf8");
  const appVersion = /^export const APP_VERSION = "([^"]+)";/m.exec(shared)?.[1];
  if (!appVersion || appVersion !== packageJson.version) throw new Error("应用版本常量与 package.json 不一致");
  const databaseSchemaVersion = await sourceNumber(join(projectRoot, "packages", "database", "src", "migration-protection.ts"), /export const CURRENT_DATABASE_SCHEMA_VERSION = (\d+);/, "数据库版本");
  const templateVersion = await sourceNumber(join(projectRoot, "packages", "domain", "src", "index.ts"), /export const DEFAULT_RESUME_STYLE:[\s\S]*?templateVersion: (\d+),/, "默认模板版本");
  const runtime = spawnSync(nodeSource, ["-p", "[process.versions.node,process.platform,process.arch].join('|')"], { encoding: "utf8", windowsHide: true });
  if (runtime.status !== 0) throw new Error("无法读取随包 Node 版本");
  const [nodeVersion, platform, architecture] = runtime.stdout.trim().split("|");
  if (!nodeVersion?.startsWith("24.") || platform !== "win32" || architecture !== "x64") throw new Error("随包 Node 运行时不符合目标平台");
  const licenses = await createLicenses(root, nodeSource);
  if (releaseTag !== undefined && licenses.missingLicenseText.length) throw new Error("公开发布仍有第三方许可原文缺口");
  const gitCommit = gitValue(["rev-parse", "HEAD"]);
  const gitStatus = gitValue(["status", "--porcelain"]);
  const version = {
    schemaVersion: 1,
    appVersion,
    ...(releaseTag !== undefined ? { releaseTag, releaseChannel: "public-preview" } : {}),
    projectLicense: "MIT",
    packageName,
    gitCommit,
    workingTreeDirty: gitStatus === null ? null : Boolean(gitStatus),
    databaseSchemaVersion,
    templateId: "standard-single-column",
    templateVersion,
    nodeVersion,
    platform,
    architecture,
    builtAtUtc: new Date().toISOString(),
    runtimeDependencyCount: licenses.packageCount,
    missingLicenseText: licenses.missingLicenseText
  };
  await writeFile(join(root, "version.json"), JSON.stringify(version, null, 2) + "\n");
  const noteSource = join(projectRoot, "docs", `发行说明-${appVersion}.md`);
  const notes = await readFile(noteSource, "utf8");
  const header = [
    `# 求职工作台 ${appVersion} 测试包发行说明`, "",
    `- 包名称：${packageName}`,
    `- 构建时间（UTC）：${version.builtAtUtc}`,
    `- Git 提交：${gitCommit ?? "未获取"}${version.workingTreeDirty ? "（工作区含未提交改动，提交号不代表包的全部内容）" : ""}`,
    `- 数据库结构版本：${databaseSchemaVersion}；默认单栏模板版本：${templateVersion}；Node.js：${nodeVersion}`,
    "- 逐文件校验见 `manifest.json`（清单自身因循环校验而排除，完整 ZIP 仍由 `.zip.sha256` 校验）；版本信息见 `version.json`；第三方许可见 `licenses/README.md`。", "",
  ];
  await writeFile(join(root, "发行说明.md"), header.join("\n") + "\n" + notes.trim() + "\n");
  await createFileManifest(root);
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileName) {
  const [action, packageRoot, nodeSource] = process.argv.slice(2);
  if (!packageRoot || !["generate", "manifest", "verify"].includes(action)) throw new Error("用法：release-metadata.mjs generate|manifest|verify 包目录 [Node 路径]");
  if (action === "generate") {
    if (!nodeSource) throw new Error("生成发布元数据时须提供 Node 路径");
    const extra = process.argv.slice(5);
    if (extra.length && (extra.length !== 2 || extra[0] !== "--public" || !extra[1])) throw new Error("公开元数据需要 --public 版本标签");
    const version = await generateReleaseMetadata(resolve(packageRoot), resolve(nodeSource), extra[1]);
    console.log(`发布元数据已生成：${version.packageName}，${version.runtimeDependencyCount} 项生产依赖`);
  } else if (action === "manifest") {
    const manifest = await createFileManifest(resolve(packageRoot));
    console.log(`发布文件清单已生成：${manifest.fileCount} 个文件`);
  } else {
    const manifest = await verifyFileManifest(resolve(packageRoot));
    console.log(`发布文件清单校验通过：${manifest.fileCount} 个文件`);
  }
}
