import { describe, expect, it } from "vitest";
import { validatePdfBuffer } from "./edge-renderer.js";

describe("PDF output validation", () => {
  it("requires a PDF header, EOF marker and a meaningful size", () => {
    const bytes = Buffer.alloc(600, 32); Buffer.from("%PDF-1.7", "ascii").copy(bytes); Buffer.from("%%EOF", "ascii").copy(bytes, bytes.length - 5);
    expect(validatePdfBuffer(bytes)).toBe(true);
    expect(validatePdfBuffer(Buffer.from("%PDF-1.7"))).toBe(false);
    bytes[0] = 88; expect(validatePdfBuffer(bytes)).toBe(false);
  });
});
