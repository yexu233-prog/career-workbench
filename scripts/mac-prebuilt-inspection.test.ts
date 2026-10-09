import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { safeArchivePath, readTarGzip, inspectMachO } from "./mac-prebuilt-inspection.mjs";

function binary(cpu = 0x0100000c, minimum = 14 << 16) {
  const b = Buffer.alloc(56); b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(cpu, 4);
  b.writeUInt32LE(1, 16); b.writeUInt32LE(24, 20); b.writeUInt32LE(0x32, 32);
  b.writeUInt32LE(24, 36); b.writeUInt32LE(1, 40); b.writeUInt32LE(minimum, 44); return b;
}
function tar(path: string) {
  const b = Buffer.alloc(1536); b.write(path, 0); b.write("0000755\0", 100); b.write("00000000000\0", 124);
  b.fill(32, 148, 156); b.write("0", 156);
  b.write(b.subarray(0, 512).reduce((sum, n) => sum + n, 0).toString(8).padStart(6, "0") + "\0 ", 148);
  return gzipSync(b);
}
describe("Windows读取Mac预编译组件", () => {
  it("拒绝绝对路径、穿越与Windows路径", () => {
    for (const p of ["/etc/a", "../a", "a/../b", "C:/a", "a\\b"]) expect(() => safeArchivePath(p)).toThrow();
    expect(safeArchivePath("package/native.node")).toBe("package/native.node");
  });
  it("在内存中校验TAR路径和头，不创建符号链接", () => {
    expect(readTarGzip(tar("package/test"))[0].mode).toBe(0o755);
    expect(() => readTarGzip(tar("../test"))).toThrow();
    expect(() => readTarGzip(Buffer.from("invalid"))).toThrow();
  });
  it("检查真实CPU而非包名", () => {
    expect(inspectMachO(binary(), "arm64").minimumMacOS).toBe("14.0.0");
    expect(() => inspectMachO(binary(), "x64")).toThrow();
    expect(inspectMachO(binary(0x01000007), "x64").architecture).toBe("x64");
  });
  it("拒绝高于14的系统要求、不完整命令和非Mac文件", () => {
    expect(() => inspectMachO(binary(undefined, 15 << 16), "arm64")).toThrow("macOS");
    expect(() => inspectMachO(binary().subarray(0, 40), "arm64")).toThrow();
    expect(() => inspectMachO(Buffer.alloc(56), "arm64")).toThrow();
    const b = binary(); b.writeUInt32LE(2, 40); expect(() => inspectMachO(b, "arm64")).toThrow();
  });
});
