import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compareRuntimePayload, macSupportStatus } from "./mac-public-release.mjs";

const entry = (path: string, value: string, mode = 0o644) => ({ path, data: Buffer.from(value), mode });
const manifest = (entries: ReturnType<typeof entry>[]) => entries.map(item => ({ path: item.path, mode: item.mode, sha256: createHash("sha256").update(item.data).digest("hex") }));
const old = [entry("web/assets/index-AAAAAAAA.js", 'const version="0.1.0-test"; const fact="fictional";'), entry("web/index.html", '<script src="/assets/index-AAAAAAAA.js"></script>'), entry("runtime/node/node", "binary", 0o755)];
const read = async (path: string) => old.find(item => item.path === path)!.data;
describe("Mac public release acceptance boundaries", () => {
  it("keeps Intel experimental even when an arm64 reference is verified", () => {
    expect(macSupportStatus("x64", true)).toMatchObject({ supportStatus: "experimental-unverified", macRuntime: "pending", human: "pending" });
    expect(macSupportStatus("arm64", true)).toMatchObject({ macRuntime: "not-executed-on-this-archive", human: "reference-user-confirmed" });
    expect(macSupportStatus("arm64", false).human).toBe("pending");
    expect(() => macSupportStatus("universal", true)).toThrow();
  });
  it("allows only version and corresponding build filename references", async () => {
    const next = [entry("web/assets/index-BBBBBBBB.js", 'const version="0.1.1-test"; const fact="fictional";'), entry("web/index.html", '<script src="/assets/index-BBBBBBBB.js"></script>'), old[2]!];
    await expect(compareRuntimePayload(next, manifest(old), read, "0.1.0-test", "0.1.1-test")).resolves.toMatchObject({ checkedFiles: 3 });
    next[0] = entry("web/assets/index-BBBBBBBB.js", 'const version="0.1.1-test"; const fact="changed";');
    await expect(compareRuntimePayload(next, manifest(old), read, "0.1.0-test", "0.1.1-test")).rejects.toThrow("运行改动");
  });
  it("blocks changed binaries, modes, missing or additional runtime files", async () => {
    for (const next of [[...old.slice(0, 2), entry("runtime/node/node", "changed", 0o755)], [...old.slice(0, 2), entry("runtime/node/node", "binary", 0o644)], old.slice(1), [...old, entry("native/new.mjs", "new")]]) {
      await expect(compareRuntimePayload(next, manifest(old), read, "0.1.0-test", "0.1.1-test")).rejects.toThrow();
    }
  });
  it("accepts version literals emitted with each JavaScript quoting style", async () => {
    for (const quote of ['"', "'", "`"]) {
      const previous = [entry("app/server.mjs", "const version=" + quote + "0.1.0-test" + quote + ";")];
      const current = [entry("app/server.mjs", "const version=" + quote + "0.1.1-test" + quote + ";")];
      await expect(compareRuntimePayload(current, manifest(previous), async () => previous[0]!.data, "0.1.0-test", "0.1.1-test")).resolves.toMatchObject({ checkedFiles: 1 });
    }
  });
  it("refuses ambiguous content-addressed filenames", async () => {
    await expect(compareRuntimePayload([...old, entry("web/assets/index-BBBBBBBB.js", "other")], manifest(old), read, "0.1.0-test", "0.1.1-test")).rejects.toThrow("冲突");
  });
});
