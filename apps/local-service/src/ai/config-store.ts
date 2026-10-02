import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AiProvider } from "@career-workbench/shared";

export interface StoredAiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey: string;
}

export interface AiConfigStore {
  load(): Promise<StoredAiConfig | undefined>;
  save(config: StoredAiConfig): Promise<void>;
  delete(): Promise<void>;
}

const protectScript = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;[Console]::InputEncoding=[Text.Encoding]::UTF8;$v=([Console]::In).ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);$p=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))";
const unprotectScript = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;[Console]::InputEncoding=[Text.Encoding]::UTF8;$v=([Console]::In).ReadToEnd();$b=[Convert]::FromBase64String($v);$p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($p))";

async function runDpapi(script: string, input: string): Promise<string> {
  if (process.platform !== "win32") throw new Error("DPAPI 仅可在 Windows 上使用");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.on("error", () => reject(new Error("无法调用 Windows 密钥保护服务")));
    child.on("close", (code) => code === 0 ? resolve(Buffer.concat(output).toString("ascii").trim()) : reject(new Error("Windows 密钥保护操作失败")));
    child.stdin.end(input, "utf8");
  });
}

export class WindowsDpapiAiConfigStore implements AiConfigStore {
  private readonly directory: string;
  private readonly file: string;

  constructor(localAppData = process.env.LOCALAPPDATA) {
    if (!localAppData) throw new Error("无法确定本机配置目录");
    this.directory = join(localAppData, "求职工作台", "secrets");
    this.file = join(this.directory, "ai-config.dat");
  }

  async load(): Promise<StoredAiConfig | undefined> {
    let encrypted: string;
    try { encrypted = await readFile(this.file, "ascii"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    const plainBase64 = await runDpapi(unprotectScript, encrypted.trim());
    return JSON.parse(Buffer.from(plainBase64, "base64").toString("utf8")) as StoredAiConfig;
  }

  async save(config: StoredAiConfig): Promise<void> {
    const encrypted = await runDpapi(protectScript, JSON.stringify(config));
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.file, encrypted, { encoding: "ascii", flag: "w", mode: 0o600 });
  }

  async delete(): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(this.file, { force: true });
  }
}

export class MemoryAiConfigStore implements AiConfigStore {
  constructor(private value?: StoredAiConfig) {}
  async load() { return this.value; }
  async save(config: StoredAiConfig) { this.value = structuredClone(config); }
  async delete() { this.value = undefined; }
}
