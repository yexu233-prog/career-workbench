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
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
}

export function parseMacSystemProxy(text: string, protocol: string): string | undefined {
  const values = new Map<string, string>();
  // Read only root-level scalar settings, not scoped/nested interface dictionaries.
  for (const line of text.split(/\r?\n/)) {
    const pair = line.match(/^ {2}([A-Za-z]+) : ([^\r\n]+)$/);
    if (pair) values.set(pair[1]!, pair[2]!.trim());
  }
  if (values.get("ProxyAutoConfigEnable") === "1" || values.get("ProxyAutoDiscoveryEnable") === "1")
    throw new Error("当前 Mac 自动代理（PAC / 自动发现）尚不支持，请改用系统 HTTP / HTTPS 代理后重试；未发送 AI 内容");
  const prefix = protocol === "https:" ? "HTTPS" : "HTTP";
  if (values.get(`${prefix}Enable`) !== "1") {
    if (values.get("SOCKSEnable") === "1") throw new Error("当前 Mac SOCKS 代理尚不支持，请改用系统 HTTP / HTTPS 代理后重试；未发送 AI 内容");
    return undefined;
  }
  const host = values.get(`${prefix}Proxy`); const port = Number(values.get(`${prefix}Port`));
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Mac 系统代理地址或端口无效，请检查网络设置；未发送 AI 内容");
  const authority = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  try { return new URL(`http://${authority}:${port}`).toString(); }
  catch { throw new Error("Mac 系统代理地址无效，请检查网络设置；未发送 AI 内容"); }
}

export async function resolveSystemProxy(target: URL): Promise<string | undefined> {
  if (isLocalTarget(target)) return undefined;
  if (process.platform !== "darwin") return getWindowsProxy();
  let text: string;
  try { text = (await execFileAsync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 5_000, maxBuffer: 128 * 1024 })).stdout; }
  catch { throw new Error("无法读取 Mac 系统代理设置，请检查网络环境后重试；未发送 AI 内容"); }
  return parseMacSystemProxy(text, target.protocol);
}

export async function requestWithSystemProxy(url: string, init: AiNetworkRequestInit): Promise<Response> {
  const target = new URL(url);
  const proxyUrl = await resolveSystemProxy(target);
  if (!proxyUrl) return fetch(url, init);
  if (!cachedProxyAgent || cachedProxyAgent.url !== proxyUrl) cachedProxyAgent = { url: proxyUrl, agent: new ProxyAgent(proxyUrl) };
  return await undiciFetch(url, { method: init.method, headers: init.headers, signal: init.signal, body: init.body, dispatcher: cachedProxyAgent.agent }) as unknown as Response;
}
