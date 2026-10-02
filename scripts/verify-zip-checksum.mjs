import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const zip = resolve(process.argv[2] ?? "");
const checksumFile = resolve(process.argv[3] ?? `${zip}.sha256`);
if (!process.argv[2]) throw new Error("请提供 ZIP 路径");
const expectedLine = (await readFile(checksumFile, "utf8")).trim();
const match = /^([a-fA-F0-9]{64})  (.+\.zip)$/.exec(expectedLine);
if (!match || match[2] !== basename(zip)) throw new Error("校验文件格式或 ZIP 文件名不匹配");
const hash = createHash("sha256");
for await (const chunk of createReadStream(zip)) hash.update(chunk);
if (hash.digest("hex") !== match[1].toLowerCase()) throw new Error("ZIP SHA-256 不匹配；请勿使用此文件");
console.log("ZIP SHA-256 校验通过");
