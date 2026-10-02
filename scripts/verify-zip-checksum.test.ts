import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    if (!directory.startsWith(resolve(tmpdir()) + "\\")) throw new Error("Unsafe test cleanup path");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("release ZIP SHA-256", () => {
  it("accepts the original ZIP and rejects a changed file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "career-checksum-test-"));
    temporaryDirectories.push(directory);
    const zip = join(directory, "sample.zip");
    const checksum = `${zip}.sha256`;
    const content = Buffer.from("fictional-release");
    await writeFile(zip, content);
    await writeFile(checksum, `${createHash("sha256").update(content).digest("hex")}  sample.zip\n`);
    const verifier = resolve("scripts/verify-zip-checksum.mjs");
    expect(execFileSync(process.execPath, [verifier, zip, checksum], { encoding: "utf8" })).toContain("校验通过");
    await writeFile(zip, Buffer.from("tampered-release"));
    expect(() => execFileSync(process.execPath, [verifier, zip, checksum], { stdio: "pipe" })).toThrow();
  });
});
