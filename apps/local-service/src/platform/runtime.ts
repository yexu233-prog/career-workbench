import { homedir } from "node:os";
import { join } from "node:path";
import type { RuntimeCapabilities } from "@career-workbench/shared";

export function getRuntimeCapabilities(platform: NodeJS.Platform = process.platform): RuntimeCapabilities {
  return {
    platform: platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "unsupported",
    secretProtection: platform === "win32" ? "Windows DPAPI" : platform === "darwin" ? "macOS 本机钥匙串" : "当前系统尚不支持密钥保存",
    pdfEngine: platform === "win32" ? "Microsoft Edge" : platform === "darwin" ? "随包 Chromium" : "未支持",
    browserDataScope: "per-browser-profile"
  };
}

export function getPlatformDataRoot(platform: NodeJS.Platform = process.platform, userHome = homedir(), localAppData = process.env.LOCALAPPDATA): string {
  if (platform === "darwin") return join(userHome, "Library", "Application Support", "求职工作台");
  if (platform === "win32" && localAppData) return join(localAppData, "求职工作台");
  throw new Error("无法确定当前系统的求职工作台配置目录");
}
