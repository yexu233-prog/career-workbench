import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMacBuildHost, assertTarget, assertBinaryArchitecture, assertNodeRuntime, assertInternalLink, createMacManifest, verifyMacManifest } from "./mac-package-policy.mjs";

describe("Mac package fail-closed rules", () => {
  it("requires real Mac build tooling, never relabels Windows", () => {
    expect(() => assertMacBuildHost("win32", "x64")).toThrow("Windows");
    expect(() => assertMacBuildHost("darwin", "arm64")).not.toThrow();
    expect(() => assertTarget("ia32")).toThrow();
  });
  it("checks each actual native architecture and runtime", () => {
    expect(() => assertBinaryArchitecture("arm64", "arm64")).not.toThrow();
    expect(() => assertBinaryArchitecture("arm64 x86_64", "x64")).toThrow();
    expect(() => assertNodeRuntime("24.19.0|darwin|x64", "x64")).not.toThrow();
    expect(() => assertNodeRuntime("24.19.0|win32|x64", "x64")).toThrow();
    expect(() => assertNodeRuntime("24.19.0|darwin|arm64", "x64")).toThrow();
  });
  it("allows framework links only inside the package", () => {
    const root = join(tmpdir(), "example-mac-package"); const file = join(root, "Framework", "Current");
    expect(() => assertInternalLink(root, file, "Versions/A")).not.toThrow();
    expect(() => assertInternalLink(root, file, "../../../private")).toThrow();
    expect(() => assertInternalLink(root, file, "/tmp/private")).toThrow();
  });
  it("detects damaged, missing and added files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mac-manifest-"));
    try {
      await writeFile(join(root, "item"), "fictional"); await createMacManifest(root); await verifyMacManifest(root);
      await writeFile(join(root, "item"), "changed"); await expect(verifyMacManifest(root)).rejects.toThrow();
      await createMacManifest(root); await writeFile(join(root, "extra"), "unexpected"); await expect(verifyMacManifest(root)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
