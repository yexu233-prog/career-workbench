import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve("scripts/release-metadata.mjs");
let directory: string;

function run(action: "manifest" | "verify") {
  return execFileSync(process.execPath, [script, action, directory], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "career-release-manifest-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("release file manifest", () => {
  it("records every file with size and SHA-256, then verifies it", async () => {
    await writeFile(join(directory, "app.txt"), "synthetic package file");
    run("manifest");
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    expect(manifest.fileCount).toBe(1);
    expect(manifest.files[0].path).toBe("app.txt");
    expect(manifest.files[0].bytes).toBe(22);
    expect(manifest.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run("verify")).toContain("校验通过");
  });

  it("rejects changed content or unlisted files", async () => {
    await writeFile(join(directory, "app.txt"), "original");
    run("manifest");
    await writeFile(join(directory, "app.txt"), "tampered");
    expect(() => run("verify")).toThrow();
    await writeFile(join(directory, "app.txt"), "original");
    await writeFile(join(directory, "unexpected.txt"), "extra");
    expect(() => run("verify")).toThrow();
  });
});
