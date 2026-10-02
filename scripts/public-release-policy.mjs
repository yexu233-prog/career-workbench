import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export async function assertPublicRelease(root, tag) {
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (tag !== `v${metadata.version}`) throw new Error("公开发布标签必须与应用版本一致");
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const head = git("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("无法确认公开发布提交");
  if (git("status", "--porcelain", "--untracked-files=all")) throw new Error("公开发布要求干净工作区，请先审查并提交全部源码改动");
  if (git("rev-parse", `${tag}^{commit}`) !== head) throw new Error("公开发布标签未指向当前提交");
  return { head, tag };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await assertPublicRelease(resolve(process.argv[2] ?? "."), process.argv[3]);
  console.log("公开发布提交与标签检查通过");
}
