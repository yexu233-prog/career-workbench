import { describe, expect, it } from "vitest";
import { normalizeWindowsProxyServer, parseMacSystemProxy, resolveSystemProxy } from "./network.js";

describe("Windows proxy discovery", () => {
  it("normalizes a simple loopback proxy", () => {
    expect(normalizeWindowsProxyServer("127.0.0.1:7890")).toBe("http://127.0.0.1:7890/");
  });

  it("prefers the HTTPS proxy in a protocol list", () => {
    expect(normalizeWindowsProxyServer("http=127.0.0.1:8080;https=127.0.0.1:7890")).toBe("http://127.0.0.1:7890/");
  });
});

describe("Mac proxy parsing", () => {
  it("selects proxy by request protocol", () => {
    const text = "<dictionary> {\n  HTTPEnable : 1\n  HTTPProxy : 127.0.0.1\n  HTTPPort : 8080\n  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7890\n}";
    expect(parseMacSystemProxy(text, "http:")).toBe("http://127.0.0.1:8080/");
    expect(parseMacSystemProxy(text, "https:")).toBe("http://127.0.0.1:7890/");
  });
  it("handles no proxy and ignores nested interface settings", () => {
    expect(parseMacSystemProxy("<dictionary> {\n  HTTPEnable : 0\n    HTTPSEnable : 1\n    HTTPSProxy : internal\n    HTTPSPort : 1234\n}", "https:")).toBeUndefined();
  });
  it("does not silently bypass PAC, auto-discovery or SOCKS", () => {
    for (const key of ["ProxyAutoConfigEnable", "ProxyAutoDiscoveryEnable", "SOCKSEnable"]) expect(() => parseMacSystemProxy(`  ${key} : 1`, "https:")).toThrow("未发送 AI 内容");
  });
  it("rejects malformed ports and credential-in-host injection", () => {
    expect(() => parseMacSystemProxy("  HTTPSEnable : 1\n  HTTPSProxy : user:secret@host\n  HTTPSPort : 7890", "https:")).toThrow("无效");
    expect(() => parseMacSystemProxy("  HTTPSEnable : 1\n  HTTPSProxy : localhost\n  HTTPSPort : 99999", "https:")).toThrow("无效");
  });
  it("always bypasses system discovery for local requests", async () => {
    for (const url of ["http://localhost:41823", "http://127.0.0.1:41823", "http://[::1]:41823"]) await expect(resolveSystemProxy(new URL(url))).resolves.toBeUndefined();
  });
});
