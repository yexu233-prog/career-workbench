import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeRuntimeDisplay } from "./runtime-client.js";

afterEach(() => vi.unstubAllGlobals());
describe("runtime display initialization", () => {
  it("sets Mac display only from service capabilities", async () => {
    const dataset: Record<string, string> = {};
    vi.stubGlobal("document", { documentElement: { dataset } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runtime: { platform: "macos" } }) }));
    await initializeRuntimeDisplay(); expect(dataset.platform).toBe("macos");
  });
  it.each([undefined, { platform: "invalid" }])("tolerates old or invalid health response", async (runtime) => {
    const dataset = {}; vi.stubGlobal("document", { documentElement: { dataset } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runtime }) }));
    await initializeRuntimeDisplay(); expect(dataset).toEqual({});
  });
  it("does not block manual startup if the service is disconnected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(initializeRuntimeDisplay()).resolves.toBeUndefined();
  });
});
