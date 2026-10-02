import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBackupBlob } from "./backup-save";

afterEach(() => vi.unstubAllGlobals());

describe("complete backup file save", () => {
  const blob = new Blob(["{}"], { type: "application/json" });

  it("reports success only after the picker stream closes", async () => {
    const close = vi.fn(async () => undefined);
    const write = vi.fn(async () => undefined);
    vi.stubGlobal("window", { showSaveFilePicker: vi.fn(async () => ({ createWritable: async () => ({ write, close }) })) });
    expect(await saveBackupBlob(blob, "backup.json")).toBe("picker");
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not report success when the picker is cancelled or writing fails", async () => {
    vi.stubGlobal("window", { showSaveFilePicker: async () => { throw new DOMException("cancel", "AbortError"); } });
    await expect(saveBackupBlob(blob, "backup.json")).rejects.toMatchObject({ name: "AbortError" });
    vi.stubGlobal("window", { showSaveFilePicker: async () => ({ createWritable: async () => ({ write: async () => { throw new Error("disk full"); }, close: vi.fn() }) }) });
    await expect(saveBackupBlob(blob, "backup.json")).rejects.toThrow("disk full");
  });

  it("marks fallback as an unconfirmed download", async () => {
    const click = vi.fn();
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    vi.stubGlobal("document", { createElement: () => ({ click }) });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:backup", revokeObjectURL: vi.fn() });
    expect(await saveBackupBlob(blob, "backup.json")).toBe("download");
    expect(click).toHaveBeenCalledOnce();
  });
});
