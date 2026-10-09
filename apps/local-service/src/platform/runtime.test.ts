import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { getPlatformDataRoot, getRuntimeCapabilities } from "./runtime.js";
import { createAiConfigStore } from "../ai/config-store-factory.js";
import { MemoryAiConfigStore, WindowsDpapiAiConfigStore } from "../ai/config-store.js";
import { MacKeychainAiConfigStore } from "../ai/mac-keychain-store.js";

describe("platform capabilities and isolation", () => {
  it("keeps Windows DPAPI and selects Mac Keychain without reading credentials", () => {
    expect(createAiConfigStore({ platform: "win32", localAppData: "C:/fictional" })).toBeInstanceOf(WindowsDpapiAiConfigStore);
    expect(createAiConfigStore({ platform: "darwin" })).toBeInstanceOf(MacKeychainAiConfigStore);
    expect(createAiConfigStore({ platform: "darwin", test: true })).toBeInstanceOf(MemoryAiConfigStore);
  });
  it("reports capabilities, not an assertion of packaged PDF availability", () => {
    expect(getRuntimeCapabilities("darwin")).toEqual({ platform: "macos", secretProtection: "macOS 本机钥匙串", pdfEngine: "随包 Chromium", browserDataScope: "per-browser-profile" });
    expect(getRuntimeCapabilities("win32").secretProtection).toBe("Windows DPAPI");
    expect(getRuntimeCapabilities("linux").platform).toBe("unsupported");
  });
  it("uses per-user service configuration, not a shared business database", () => {
    expect(getPlatformDataRoot("darwin", "/Users/虚构用户")).toBe(join("/Users/虚构用户", "Library", "Application Support", "求职工作台"));
    expect(getPlatformDataRoot("win32", "/ignored", "C:/fictional")).toBe(join("C:/fictional", "求职工作台"));
    expect(() => getPlatformDataRoot("linux")).toThrow("配置目录");
  });
  it("does not fall back to a plaintext store on unsupported platforms", async () => {
    await expect(createAiConfigStore({ platform: "linux" }).load()).rejects.toThrow("手动功能");
    await expect(createAiConfigStore({ platform: "darwin" }).load()).rejects.toThrow("组件未就绪");
  });
});
