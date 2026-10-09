import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, lstat, readFile, copyFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";
import { NODE_MAC, sha256 } from "./mac-package-policy.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(project, "release", `mac-build-kit-${randomUUID()}`);
const omitted = new Set(["node_modules", "dist", "release", "tmp", ".git", ".cache", ".vite", "coverage"]);
const streams = [];
async function copyTree(folder, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (omitted.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    const source = join(folder, entry.name); const target = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (entry.isFile()) {
      if (!/\.(?:ts|tsx|mjs|json|css|html|md|txt|swift|otf|ps1|cmd|yml)$/i.test(entry.name)) throw new Error("构建材料中发现未经允许的文件类型");
      if (/\.(?:ts|tsx|mjs|json|swift)$/i.test(entry.name)) {
        const body = await readFile(source, "utf8");
        if (/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AIza[A-Za-z0-9_-]{30,})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(body)) throw new Error("构建材料疑似含密钥，已阻止打包；不打印命中内容");
      }
      await copyFile(source, target);
    } else throw new Error("构建材料不允许符号链接或特殊文件");
  }
}
async function main() {
  await mkdir(output, { recursive: true });
  for (const tree of ["apps", "packages", "native", "scripts", "assets/fonts", "third_party/licenses"]) await copyTree(join(project, tree), join(output, tree));
  for (const file of ["package.json", "package-lock.json", "tsconfig.base.json", "vitest.config.ts", "LICENSE"]) await copyFile(join(project, file), join(output, file));
  await mkdir(join(output, "docs"));
  await copyFile(join(project, "docs/Mac测试版使用说明.md"), join(output, "docs/Mac测试版使用说明.md"));
  await copyFile(join(project, "docs/Mac测试版使用说明.md"), join(output, "先读我.md"));
  const command = `#!/bin/bash\nset -eu\ncd "$(dirname "$0")"\nif [ "$(/usr/bin/uname -s)" != "Darwin" ]; then echo "只能在Mac执行"; exit 1; fi\nif ! /usr/bin/xcrun --find swiftc >/dev/null 2>&1; then echo "缺少Apple Swift工具链。不会自动安装，请将提示告知开发者。"; read -r _; exit 1; fi\ncase "$(/usr/bin/uname -m)" in\n  arm64) kit_arch=arm64; kit_hash=${NODE_MAC.arm64} ;;\n  x86_64) kit_arch=x64; kit_hash=${NODE_MAC.x64} ;;\n  *) echo "芯片不支持"; exit 1 ;;\nesac\nkit_boot=$(/usr/bin/mktemp -d "$PWD/.bootstrap.XXXXXX")\nkit_archive="$kit_boot/node.tar.gz"\n/usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 1800 --output "$kit_archive" "https://nodejs.org/dist/v${NODE_MAC.version}/node-v${NODE_MAC.version}-darwin-$kit_arch.tar.gz"\nkit_actual=$(/usr/bin/shasum -a 256 "$kit_archive")\nif [ "\${kit_actual%% *}" != "$kit_hash" ]; then echo "Node官方校验失败，停止。"; exit 1; fi\n/usr/bin/tar -xzf "$kit_archive" -C "$kit_boot"\nexport PATH="$kit_boot/node-v${NODE_MAC.version}-darwin-$kit_arch/bin:$PATH"\nnpm ci --ignore-scripts\nnpm run release:mac:both\necho "请查看release中的构建结果与验收状态；非本机架构尚未运行验证。"\nread -r _\n`;
  const safeCommand = command.replace("if ! /usr/bin/xcrun --find swiftc", "if ! /usr/bin/xcode-select -p >/dev/null 2>&1 || ! /usr/bin/xcrun --find swiftc");
  await writeFile(join(output, "制作两套Mac测试包.command"), safeCommand);
  const zip = new JSZip();
  async function add(folder) {
    for (const name of await readdir(folder)) {
      const file = join(folder, name); const info = await lstat(file);
      if (info.isDirectory()) await add(file);
      else {
        const path = relative(output, file).split(sep).join("/"); const stream = createReadStream(file); streams.push(stream);
        zip.file(`mac-build-kit/${path}`, stream, { unixPermissions: path.endsWith(".command") ? 0o100755 : 0o100644 });
      }
    }
  }
  await add(output);
  const archive = output + ".zip";
  await pipeline(zip.generateNodeStream({ type: "nodebuffer", platform: "UNIX", streamFiles: true, compression: "DEFLATE" }), createWriteStream(archive, { flags: "wx" }));
  const hash = await sha256(archive); await writeFile(archive + ".sha256", `${hash}  ${archive.split(sep).at(-1)}\n`, { flag: "wx" });
  console.log(`构建材料（不是Mac测试包）：${archive}\nSHA-256：${hash}\n仅本地生成，未上传。`);
}
main().catch(() => { console.error("Mac构建材料准备失败；未上传，现有包未改变。"); process.exitCode = 1; }).finally(() => { for (const stream of streams) stream.destroy(); });
