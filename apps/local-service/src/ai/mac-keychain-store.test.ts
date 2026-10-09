import { describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { MacKeychainAiConfigStore, createKeychainRunner, stopMacKeychainHelpers, type KeychainOperation } from "./mac-keychain-store.js";
import type { StoredAiConfig } from "./config-store.js";

const config: StoredAiConfig = { provider: "qwen", baseUrl: "https://example.invalid/v1", model: "fictional-model", timeoutMs: 120_000, apiKey: "fictional-key-not-a-real-secret" };
const fixture = fileURLToPath(new URL("../../../../scripts/mac-keychain-runner.fixture.mjs", import.meta.url));

describe("Mac helper transport (real Node subprocess, no Keychain access)", () => {
  it("passes configuration only through stdin and removes injection environment", async () => {
    vi.stubEnv("NODE_OPTIONS", "--require=nonexistent-injection-file");
    vi.stubEnv("NODE_PATH", "fictional-injection");
    vi.stubEnv("DYLD_INSERT_LIBRARIES", "fictional-injection");
    try {
      const input = JSON.stringify(config);
      await expect(createKeychainRunner(fixture, true)("save", input)).resolves.toEqual({ input, args: ["save"], injectionVariables: [] });
    } finally { vi.unstubAllEnvs(); }
  });
  it("cancels and drains an owned helper before reporting service shutdown", async () => {
    const operation = createKeychainRunner(fixture, true)("delete");
    const result = expect(operation).rejects.toThrow("钥匙串操作已取消");
    await stopMacKeychainHelpers();
    await result;
    await stopMacKeychainHelpers();
  });
});

describe("Mac keychain store contract (native calls simulated)", () => {
  it("loads missing records and round trips only through the injected native runner", async () => {
    let value: unknown = null;
    const run = vi.fn(async (operation: KeychainOperation, input?: string) => {
      if (operation === "load") return value;
      value = operation === "delete" ? null : JSON.parse(input!); return true;
    });
    const store = new MacKeychainAiConfigStore(run);
    expect(await store.load()).toBeUndefined();
    await store.save(config); expect(await store.load()).toEqual(config);
    expect(run.mock.calls[1]).toEqual(["save", JSON.stringify(config)]);
    await store.delete(); expect(await store.load()).toBeUndefined();
  });
  it("rejects malformed stored configuration without exposing its contents", async () => {
    for (const value of [{ ...config, provider: "unknown" }, { ...config, timeoutMs: NaN }, { ...config, baseUrl: "https://user:secret@example.invalid" }, { ...config, apiKey: "" }, "fictional-sensitive-input"]) {
      const store = new MacKeychainAiConfigStore(async () => value);
      await expect(store.load()).rejects.toThrow();
      try { await store.load(); } catch (error) { expect((error as Error).message).not.toContain(config.apiKey); expect((error as Error).message).not.toContain("fictional-sensitive-input"); }
    }
  });
  it("rejects invalid writes before invoking native code", async () => {
    const run = vi.fn(async () => true);
    await expect(new MacKeychainAiConfigStore(run).save({ ...config, apiKey: "" })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it("does not acknowledge unconfirmed saves or deletes", async () => {
    const store = new MacKeychainAiConfigStore(async () => false);
    await expect(store.save(config)).rejects.toThrow("未确认保存");
    await expect(store.delete()).rejects.toThrow("未确认删除");
  });
  it("fails closed when a helper is absent, relative or cannot launch", async () => {
    await expect(createKeychainRunner()("load")).rejects.toThrow("手动功能");
    await expect(createKeychainRunner("relative-helper")("load")).rejects.toThrow("组件未就绪");
    await expect(createKeychainRunner("/nonexistent-fictional-helper")("save", JSON.stringify(config))).rejects.toThrow("无法启动");
  });
  it("checks source-level privacy requirements without claiming native acceptance", () => {
    const source = readFileSync(new URL("../../../../native/macos/KeychainHelper.swift", import.meta.url), "utf8");
    expect(source).toContain("kSecAttrSynchronizable as String: false");
    expect(source).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(source).toContain("FileHandle.standardInput");
    expect(source).not.toContain("print(config)");
  });
});
