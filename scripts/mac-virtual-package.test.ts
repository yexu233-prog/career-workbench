import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createVirtualZip, readZipEntries, validateVirtualEntries, virtualManifest } from "./mac-virtual-package.mjs";

const file = (path: string) => ({ path, data: Buffer.from("fixture"), mode: 0o755 });
const link = (path: string, target: string) => ({ ...file(path), link: target });
describe("Mac virtual ZIP assembly", () => {
  it("preserves executable mode, content and internal links", async () => {
    const entries = [file("runtime/node"), file("Framework/Versions/A/data"), link("Framework/Current", "Versions/A")];
    const bytes = await createVirtualZip(entries, "test-package").generateAsync({ type: "nodebuffer", platform: "UNIX" });
    const restored = await readZipEntries(bytes);
    expect(restored.find(e => e.path.endsWith("runtime/node"))?.mode).toBe(0o755);
    expect(restored.find(e => e.path.endsWith("Current"))?.link).toBe("Versions/A");
    expect(virtualManifest(entries).files).toHaveLength(3);
  });
  it("rejects escapes, cycles, dangling links and conflicting paths", () => {
    for (const entries of [[file("../a")], [file("A"), file("a")], [file("a"), file("a/b")], [link("a", "/tmp/b")], [link("a", "../b")], [link("a", "missing")], [link("a", "b"), link("b", "a")]]) expect(() => validateVirtualEntries(entries)).toThrow();
  });
  it("checks raw ZIP names before JSZip can sanitize them", async () => {
    const zip = new JSZip(); zip.file("../escape", "bad");
    await expect(readZipEntries(await zip.generateAsync({ type: "nodebuffer" }))).rejects.toThrow();
  });
});
