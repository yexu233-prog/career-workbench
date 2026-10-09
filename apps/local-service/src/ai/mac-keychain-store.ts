import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { AI_PROVIDERS } from "@career-workbench/shared";
import type { AiConfigStore, StoredAiConfig } from "./config-store.js";

export type KeychainOperation = "load" | "save" | "delete";
export type KeychainRunner = (operation: KeychainOperation, input?: string) => Promise<unknown>;
const MAX_MESSAGE_BYTES = 64 * 1024;
const activeHelpers = new Map<() => void, Promise<void>>();

export async function stopMacKeychainHelpers(): Promise<void> {
  const helpers = [...activeHelpers];
  for (const [stop] of helpers) stop();
  await Promise.all(helpers.map(([, closed]) => closed));
}

function validateStoredConfig(value: unknown): StoredAiConfig {
  if (!value || typeof value !== "object") throw new Error("本机钥匙串中的 AI 配置损坏，请重新配置；不会使用明文回退");
  const v = value as Partial<StoredAiConfig>;
  let url: URL;
  try { url = new URL(v.baseUrl ?? ""); } catch { throw new Error("本机钥匙串中的 AI 接口地址无效，请重新配置"); }
  if (!AI_PROVIDERS.includes(v.provider as never) || typeof v.model !== "string" || !v.model.trim() || v.model.length > 100 ||
      typeof v.apiKey !== "string" || !v.apiKey.trim() || v.apiKey.length > 16_384 ||
      typeof v.timeoutMs !== "number" || !Number.isFinite(v.timeoutMs) || v.timeoutMs < 10_000 || v.timeoutMs > 120_000 ||
      url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) {
    throw new Error("本机钥匙串中的 AI 配置无效，请重新配置；手动功能不受影响");
  }
  return { provider: v.provider!, baseUrl: v.baseUrl!, model: v.model, timeoutMs: v.timeoutMs, apiKey: v.apiKey };
}

export function createKeychainRunner(helperPath?: string, script = false): KeychainRunner {
  return async (operation, input = "") => {
    if (!helperPath || !isAbsolute(helperPath)) throw new Error("Mac 钥匙串组件未就绪，请使用完整 Mac 测试包；手动功能不受影响");
    if (Buffer.byteLength(input, "utf8") > MAX_MESSAGE_BYTES) throw new Error("AI 配置过长，未保存");
    return new Promise<unknown>((resolve, reject) => {
      // Only the operation enters argv. Credentials travel through stdin, never a shell.
      const env = { ...process.env };
      for (const name of Object.keys(env)) if (name === "NODE_OPTIONS" || name === "NODE_PATH" || name.startsWith("DYLD_")) delete env[name];
      const child = spawn(script ? process.execPath : helperPath, script ? [helperPath, operation] : [operation], { stdio: ["pipe", "pipe", "ignore"], shell: false, env });
      const chunks: Buffer[] = []; let bytes = 0; let failure: Error | undefined;
      let escalation: NodeJS.Timeout | undefined;
      const terminate = () => { child.kill(); escalation ??= setTimeout(() => child.kill("SIGKILL"), 2000); };
      const stop = () => { failure = new Error("本机服务正在停止，钥匙串操作已取消；下次启动后请检查保存状态"); terminate(); };
      let markClosed!: () => void;
      activeHelpers.set(stop, new Promise<void>(resolveClosed => { markClosed = resolveClosed; }));
      const timer = setTimeout(() => { failure = new Error("钥匙串操作超时，请确认系统授权后重试；操作可能已生效，请先重新检查；手动功能不受影响"); terminate(); }, 45_000);
      child.stdin.on("error", () => { /* A missing or denied helper may close its input early. */ });
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_MESSAGE_BYTES) { failure = new Error("钥匙串响应异常，未使用返回内容"); terminate(); return; }
        chunks.push(chunk);
      });
      child.once("error", () => { clearTimeout(timer); reject(new Error("无法启动 Mac 钥匙串组件，请检查测试包与系统授权；手动功能不受影响")); });
      child.once("close", (code) => {
        activeHelpers.delete(stop); markClosed();
        clearTimeout(timer); clearTimeout(escalation);
        if (failure) { reject(failure); return; }
        if (code !== 0) {
          reject(new Error(code === 3 ? "钥匙串未解锁或授权被拒绝，请解锁并允许随包 Node 访问本应用配置后重试；手动功能不受影响" : "Mac 钥匙串操作失败，请检查系统授权或重新配置；手动功能不受影响")); return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("Mac 钥匙串返回格式无效；未读取或保存配置")); }
      });
      child.stdin.end(input, "utf8");
    });
  };
}

export class MacKeychainAiConfigStore implements AiConfigStore {
  constructor(private readonly run: KeychainRunner) {}
  async load(): Promise<StoredAiConfig | undefined> {
    const result = await this.run("load");
    return result === null ? undefined : validateStoredConfig(result);
  }
  async save(config: StoredAiConfig): Promise<void> {
    const value = validateStoredConfig(config);
    const input = JSON.stringify(value);
    if (Buffer.byteLength(input, "utf8") > MAX_MESSAGE_BYTES) throw new Error("AI 配置过长，未保存");
    if (await this.run("save", input) !== true) throw new Error("本机钥匙串未确认保存成功，请重试");
  }
  async delete(): Promise<void> {
    if (await this.run("delete") !== true) throw new Error("本机钥匙串未确认删除成功，请重试");
  }
}
