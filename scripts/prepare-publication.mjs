import { copyFile, mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["apps", "packages", ".github", "assets/fonts", "third_party/licenses"];
const files = [".gitignore", ".gitattributes", "README.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "package.json", "package-lock.json", "tsconfig.base.json", "vitest.config.ts", "startup.cmd", "shutdown.cmd", "docs/Windows测试版使用说明.md", "docs/架构与隐私说明.md", "docs/许可证核对记录.md", "docs/发行说明-0.1.0-test.md"];
const scripts = ["bundle-service.mjs", "build-release.ps1", "start-app.ps1", "stop-app.ps1", "release-metadata.mjs", "verify-release.mjs", "verify-zip-checksum.mjs", "verify-zip-checksum.test.ts", "create-release-zip.mjs", "create-release-zip.test.ts", "pdf-regression.mjs", "resume-template-regression.tsx", "public-release-policy.mjs", "prepare-publication.mjs"];
const excluded = new Set(["node_modules", "dist", ".git", ".cache", ".vite", "coverage", "tmp", "release"]);
const allowedExtensions = /\.(?:ts|tsx|mjs|json|css|html|md|txt|yml|ps1|cmd|otf)$/i;
const slash = (path) => path.split(sep).join("/");

export function reviewText(text, path) {
  const findings = [];
  const rules = [
    ["block", "疑似服务密钥", /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{30,})\b/],
    ["block", "私钥正文", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["block", "个人电脑绝对路径", /[A-Z]:[\\/]Users[\\/][A-Za-z0-9_.-]+[\\/]/i],
    ["review", "手机号或测试手机号", /(?<!\d)1[3-9]\d{9}(?!\d)/],
    ["review", "可能的个人邮箱", /[\w.+-]+@(?!(?:example\.(?:com|test|org)|localhost)\b)[\w.-]+\.[A-Za-z]{2,}/]
  ];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const [severity, kind, pattern] of rules) {
      if (pattern.test(line)) findings.push({ path, line: index + 1, severity, kind });
    }
  }
  return findings; // Never include matched text or credentials in the report.
}

async function collect(path, base) {
  const result = [];
  for (const entry of await readdir(join(base, path), { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    const child = `${path}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`禁止导出符号链接：${child}`);
    if (entry.isDirectory()) result.push(...await collect(child, base));
    else if (allowedExtensions.test(entry.name) || /^(?:LICENSE|COPYING|NOTICE)$/i.test(entry.name)) result.push(child);
    else throw new Error(`公开目录出现未审核文件类型：${child}`);
  }
  return result;
}

export async function preparePublication(destination) {
  const output = resolve(destination);
  const safeRoot = join(projectRoot, "tmp") + sep;
  if (!output.startsWith(safeRoot) || !output.split(sep).at(-1).startsWith("github-publication-")) throw new Error("公开候选只能导出到 tmp/github-publication-* 新目录");
  if (await lstat(output).catch(() => undefined)) throw new Error("候选目录已存在，拒绝覆盖；请使用新目录");
  const list = [...files, ...scripts.map((name) => `scripts/${name}`)];
  for (const root of roots) list.push(...await collect(root, projectRoot));
  const entries = [];
  const findings = [];
  for (const path of [...new Set(list)].sort()) {
    const source = join(projectRoot, ...path.split("/"));
    if (!(await lstat(source)).isFile()) throw new Error(`公开候选缺少文件：${path}`);
    const data = await readFile(source);
    if (!data.length) throw new Error(`公开候选文件为空：${path}`);
    if (!path.endsWith(".otf")) findings.push(...reviewText(data.toString("utf8"), path));
    entries.push({ path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") });
  }
  await mkdir(dirname(output), { recursive: true });
  const report = { schemaVersion: 1, createdAtUtc: new Date().toISOString(), repository: "yexu233-prog/career-workbench", candidate: slash(relative(projectRoot, output)), files: entries, findings, requiresHumanReview: true };
  const reportPath = output + ".review.json";
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (findings.some((item) => item.severity === "block")) throw new Error(`发现阻断项，未导出源码；仅位置报告：${reportPath}`);
  await mkdir(output);
  for (const entry of entries) {
    const target = join(output, ...entry.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(projectRoot, ...entry.path.split("/")), target);
  }
  console.log(`已生成待审核候选：${output}\n文件：${entries.length}；人工核对位置：${findings.length}；报告：${reportPath}\n尚未初始化 Git、上传或公开。`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  await preparePublication(process.argv[2] ?? join(projectRoot, "tmp", `github-publication-${stamp}`));
}
