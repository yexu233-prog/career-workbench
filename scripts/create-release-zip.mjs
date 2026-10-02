import { createReadStream, createWriteStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";

const root = resolve(process.argv[2] ?? "");
const target = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3] || !target.endsWith(".zip") || target.startsWith(root + sep)) throw new Error("ZIP 输入或输出路径无效");
const zip = new JSZip();
const inputs = [];
async function add(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await add(path);
    else if (entry.isFile()) {
      const stream = createReadStream(path);
      inputs.push(stream);
      zip.file(`${basename(root)}/${relative(root, path).split(sep).join("/")}`, stream);
    } else throw new Error("ZIP 不允许特殊文件或符号链接");
  }
}
try {
  await add(root);
  await pipeline(zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } }), createWriteStream(target, { flags: "wx" }));
  console.log("ZIP 流式压缩完成");
} finally {
  for (const stream of inputs) stream.destroy();
}
