import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const execFileAsync = promisify(execFile);
const internetSettingsKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";

async function readRegistryValue(name: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", internetSettingsKey, "/v", name], { windowsHide: true, encoding: "utf8", timeout: 5_000 });
    const match = stdout.match(new RegExp(`${name}\\s+REG_(?:SZ|DWORD)\\s+(.+)$`, "mi"));
    return match?.[1]?.trim() ?? "";
  } catch { return ""; }
}

export function normalizeWindowsProxyServer(value: string): string | undefined {
  const parts = value.split(";").map((part) => part.trim()).filter(Boolean);
  const selected = parts.find((part) => /^https=/i.test(part)) ?? parts.find((part) => /^http=/i.test(part)) ?? parts[0];
  if (!selected) return undefined;
  const address = selected.includes("=") ? selected.slice(selected.indexOf("=") + 1).trim() : selected;
  if (!address) return undefined;
  try {
    const url = new URL(address.includes("://") ? address : `http://${address}`);
    if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "socks:" && url.protocol !== "socks5:") return undefined;
    return url.toString();
  } catch { return undefined; }
}

export interface AiNetworkRequestInit {
  method: "POST";
  headers: Record<string, string>;
  signal: AbortSignal;
  body: string;
}

let cachedWindowsProxy: Promise<string | undefined> | undefined;
let cachedProxyAgent: { url: string; agent: ProxyAgent } | undefined;

async function getWindowsProxy(): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  cachedWindowsProxy ??= Promise.all([readRegistryValue("ProxyEnable"), readRegistryValue("ProxyServer")]).then(([enabled, server]) => enabled.toLocaleLowerCase() === "0x1" ? normalizeWindowsProxyServer(server) : undefined);
  return cachedWindowsProxy;
}

function isLocalTarget(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

export async function requestWithSystemProxy(url: string, init: AiNetworkRequestInit): Promise<Response> {
  const target = new URL(url);
  const proxyUrl = isLocalTarget(target) ? undefined : await getWindowsProxy();
  if (!proxyUrl) return fetch(url, init);
  if (!cachedProxyAgent || cachedProxyAgent.url !== proxyUrl) cachedProxyAgent = { url: proxyUrl, agent: new ProxyAgent(proxyUrl) };
  return await undiciFetch(url, { method: init.method, headers: init.headers, signal: init.signal, body: init.body, dispatcher: cachedProxyAgent.agent }) as unknown as Response;
}
