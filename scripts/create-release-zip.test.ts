import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import JSZip from "jszip";
import { expect, it } from "vitest";

it("archives and extracts a package file beyond Windows legacy path limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "career-long-zip-"));
  try {
    const root = join(directory, "synthetic-package");
    const nested = ["a".repeat(80), "b".repeat(80), "c".repeat(80)];
    const leaf = join(root, ...nested);
    await mkdir(leaf, { recursive: true });
    await writeFile(join(leaf, "中文说明.txt"), "synthetic package only");
    const target = join(directory, "package.zip");
    execFileSync(process.execPath, [resolve("scripts/create-release-zip.mjs"), root, target], { windowsHide: true, stdio: "pipe" });
    const zip = await JSZip.loadAsync(await readFile(target));
    expect(await zip.file(`synthetic-package/${nested.join("/")}/中文说明.txt`)?.async("string")).toBe("synthetic package only");
    expect(() => execFileSync(process.execPath, [resolve("scripts/create-release-zip.mjs"), root, target], { stdio: "pipe" })).toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
