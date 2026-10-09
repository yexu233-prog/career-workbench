import { describe, expect, it, vi } from "vitest";
import { checkKeychainStatus, executeKeychainOperation, KeychainError } from "../native/macos/keychain-operations.mjs";
import { createLocalKeychainBackend } from "../native/macos/keychain-backend.mjs";

const config = Buffer.from(JSON.stringify({ provider: "qwen", apiKey: "fictional-private-value", model: "fictional" }));
function memory() {
  let data: Buffer | null = null;
  return { read: vi.fn(() => data && Buffer.from(data)), write: vi.fn((value: Buffer) => { data = Buffer.from(value); }), remove: vi.fn(() => { data = null; }) };
}
describe("isolated Mac Keychain operations", () => {
  it("round trips and confirms mutations", () => {
    const store = memory(); expect(executeKeychainOperation(store, "load")).toBeNull();
    expect(executeKeychainOperation(store, "save", config)).toBe(true);
    expect(executeKeychainOperation(store, "load")).toEqual(JSON.parse(config.toString()));
    expect(executeKeychainOperation(store, "delete")).toBe(true);
    expect(executeKeychainOperation(store, "delete")).toBe(true);
  });
  it("does not overwrite inaccessible or corrupted data", () => {
    const store = memory(); store.read.mockImplementation(() => { throw new KeychainError("access"); });
    expect(() => executeKeychainOperation(store, "save", config)).toThrow(); expect(store.write).not.toHaveBeenCalled();
    store.read.mockImplementation(() => Buffer.from("damaged"));
    expect(() => executeKeychainOperation(store, "save", config)).toThrow(); expect(store.write).not.toHaveBeenCalled();
  });
  it("does not acknowledge failed writes/deletes", () => {
    const store = memory(); store.write.mockImplementation(() => {});
    expect(() => executeKeychainOperation(store, "save", config)).toThrow();
    store.read.mockImplementation(() => Buffer.from(config)); store.remove.mockImplementation(() => {});
    expect(() => executeKeychainOperation(store, "delete")).toThrow();
  });
  it("bounds inputs and hides native errors", () => {
    expect(() => executeKeychainOperation(memory(), "save", Buffer.alloc(65537))).toThrow();
    for (const code of [-128, -25293, -25308, -25291, -50]) {
      expect(() => checkKeychainStatus(code)).toThrow("Mac钥匙串操作未完成");
    }
    expect(() => executeKeychainOperation(memory(), "invalid")).toThrow();
  });
  it("targets user file-based Keychain and propagates deletion denial", () => {
    const releases: unknown[] = [];
    const fake = { load: (path: string) => ({ func: (declaration: string) => {
      expect(path.startsWith("/System/Library/Frameworks/")).toBe(true);
      if (declaration.includes("SecKeychainCopyDomainDefault")) return (domain: number, out: unknown[]) => { expect(domain).toBe(0); out[0] = 1n; return 0; };
      if (declaration.includes("SecKeychainGetStatus")) return (_: unknown, out: unknown[]) => { out[0] = 1; return 0; };
      if (declaration.includes("SecKeychainFindGenericPassword")) return (...args: any[]) => { expect(args[2].toString()).toBe("career-workbench.local-ai-config"); args[5][0] = 0; args[7][0] = 2n; return 0; };
      if (declaration.includes("SecKeychainItemDelete")) return () => -25293;
      if (declaration.includes("CFRelease")) return (value: unknown) => releases.push(value);
      return () => 0;
    } }), view: vi.fn() };
    const store = createLocalKeychainBackend(fake);
    expect(() => store.remove()).toThrow(); store.close(); store.close();
    expect(releases).toEqual([2n, 1n]);
  });
});
