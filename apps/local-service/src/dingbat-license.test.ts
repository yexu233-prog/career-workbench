import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const dingbat = require("dingbat-to-unicode") as {
  codePoint(font: string, code: number): { codePoint: number; string: string } | undefined;
  dec(font: string, code: string): { codePoint: number; string: string } | undefined;
  hex(font: string, code: string): { codePoint: number; string: string } | undefined;
};

it("preserves all 1061 mappings from 1.0.1 when updating for license completeness", () => {
  const hash = createHash("sha256");
  let count = 0;
  for (const font of ["Symbol", "Webdings", "Wingdings", "Wingdings 2", "Wingdings 3"]) {
    for (let code = 0; code <= 65535; code += 1) {
      const value = dingbat.codePoint(font, code);
      if (!value) continue;
      hash.update(JSON.stringify([font, code, value.codePoint, value.string]) + "\n");
      count += 1;
    }
  }
  expect(count).toBe(1061);
  expect(hash.digest("hex")).toBe("34c29720be61bd0ff7fa0b0ced34f591c068682e47100de9e60b1b60362ae82d");
  expect(dingbat.dec("wingdings", "41")).toEqual(dingbat.codePoint("Wingdings", 41));
  expect(dingbat.hex("Wingdings", "29")).toEqual(dingbat.codePoint("Wingdings", 41));
  expect(dingbat.codePoint("Unknown", 41)).toBeUndefined();
});

it("installs pinned 1.0.2 with the upstream complete BSD notice", async () => {
  const root = dirname(require.resolve("dingbat-to-unicode/package.json"));
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const license = await readFile(join(root, "LICENSE"), "utf8");
  expect(metadata.version).toBe("1.0.2");
  expect(metadata.license).toBe("BSD-2-Clause");
  expect(license).toContain("Copyright (c) 2021, Michael Williamson");
  expect(license).toContain("Redistributions of source code must retain");
  expect(license).toContain("Redistributions in binary form must reproduce");
  expect(license).toContain("THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS");
});
