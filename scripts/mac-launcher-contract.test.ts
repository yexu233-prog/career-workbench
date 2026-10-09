import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("Mac launcher source security contracts (not native compilation)", () => {
  it("uses argument arrays, private stop token, loopback and instance identity", async () => {
    const source = await readFile(new URL("../native/macos/Launcher.swift", import.meta.url), "utf8");
    expect(source).toContain("http://127.0.0.1:41823"); expect(source).toContain("LOCK_EX | LOCK_NB");
    expect(source).toContain("O_NOFOLLOW"); expect(source).toContain("0o600"); expect(source).toContain("--instance-id");
    expect(source).toContain('health["instanceId"]'); expect(source).toContain("completionHandler(nil)");
    expect(source).not.toContain("/bin/sh"); expect(source).not.toContain("security add-generic-password");
  });
  it("builds both actual target architectures but gates ZIP on runtime checks", async () => {
    const build = await readFile(new URL("./build-mac-both.mjs", import.meta.url), "utf8");
    const verify = await readFile(new URL("./verify-mac-package.mjs", import.meta.url), "utf8");
    expect(build).toContain("for (const arch of MAC_TARGETS)"); expect(build).toContain("assertBinaryArchitecture");
    expect(build).toContain("process.arch"); expect(verify).toContain("process.arch !== arch");
    expect(verify.indexOf("chrome://credits")).toBeLessThan(verify.indexOf('"-c", "-k"'));
    expect(verify).toContain('redirect: "error"'); expect(verify).toContain('validation = "automatic-smoke-passed-human-pending"');
  });
});
