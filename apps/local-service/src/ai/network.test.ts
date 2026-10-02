import { describe, expect, it } from "vitest";
import { normalizeWindowsProxyServer } from "./network.js";

describe("Windows proxy discovery", () => {
  it("normalizes a simple loopback proxy", () => {
    expect(normalizeWindowsProxyServer("127.0.0.1:7890")).toBe("http://127.0.0.1:7890/");
  });

  it("prefers the HTTPS proxy in a protocol list", () => {
    expect(normalizeWindowsProxyServer("http=127.0.0.1:8080;https=127.0.0.1:7890")).toBe("http://127.0.0.1:7890/");
  });
});
