import { MemoryAiConfigStore, WindowsDpapiAiConfigStore, type AiConfigStore } from "./config-store.js";
import { createKeychainRunner, MacKeychainAiConfigStore, type KeychainRunner } from "./mac-keychain-store.js";

export function createAiConfigStore(options: { platform?: NodeJS.Platform; test?: boolean; keychainHelperPath?: string; keychainScriptPath?: string; keychainRunner?: KeychainRunner; localAppData?: string } = {}): AiConfigStore {
  if (options.test) return new MemoryAiConfigStore();
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return new WindowsDpapiAiConfigStore(options.localAppData);
  if (platform === "darwin") return new MacKeychainAiConfigStore(options.keychainRunner ?? createKeychainRunner(options.keychainScriptPath ?? options.keychainHelperPath, Boolean(options.keychainScriptPath)));
  const fail = async (): Promise<never> => { throw new Error("当前系统尚不支持安全保存 AI 配置；手动功能仍可使用"); };
  return { load: fail, save: fail, delete: fail };
}
