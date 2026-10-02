import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

let root: string;
const script = resolve("scripts/public-release-policy.mjs");
function git(...args: string[]) {
  return execFileSync("git", args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}
function validate(tag = "v0.1.0-test") {
  return execFileSync(process.execPath, [script, root, tag], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "career-public-policy-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ version: "0.1.0-test" }));
  git("init", "-b", "main");
  git("add", "package.json");
  git("-c", "user.name=Synthetic Test", "-c", "user.email=test@example.test", "commit", "-m", "synthetic fixture");
  git("tag", "v0.1.0-test");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
it("accepts clean tagged source", () => { expect(validate().toString()).toContain("检查通过"); });
it("rejects dirty or untracked source", async () => {
  await writeFile(join(root, "private.txt"), "synthetic fixture");
  expect(() => validate()).toThrow();
});
it("rejects mismatched versions and tags on earlier commits", async () => {
  expect(() => validate("v0.2.0")).toThrow();
  await writeFile(join(root, "source.txt"), "synthetic source");
  git("add", ".");
  git("-c", "user.name=Synthetic Test", "-c", "user.email=test@example.test", "commit", "-m", "next fixture");
  expect(() => validate()).toThrow();
});
