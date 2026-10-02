import type { AiServiceConfigInput, AiServiceStatus, AiTaskRequest, AiTaskResponse } from "@career-workbench/shared";
import { localServiceError } from "./user-errors";

let clientToken = "";

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => { throw new Error("本机 AI 服务响应异常，请重启求职工作台后重试。"); }) as T & { message?: string };
  if (!response.ok) throw new Error(data.message || "本机 AI 服务请求失败");
  return data;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try { return await fetch(path, init); }
  catch (error) { throw localServiceError(error, "使用 AI 服务"); }
}

export async function getAiStatus(): Promise<AiServiceStatus> {
  const status = await readResponse<AiServiceStatus>(await request("/api/ai/status"));
  clientToken = status.clientToken;
  return status;
}

async function withToken<T>(path: string, init: RequestInit): Promise<T> {
  if (!clientToken) await getAiStatus();
  return readResponse<T>(await request(path, { ...init, headers: { "content-type": "application/json", "x-ai-client-token": clientToken, ...init.headers } }));
}

export async function saveAiConfig(config: AiServiceConfigInput): Promise<void> {
  await withToken("/api/ai/config", { method: "POST", body: JSON.stringify(config) });
}

export async function deleteAiConfig(): Promise<void> {
  await withToken("/api/ai/config", { method: "DELETE" });
}

export async function testAiConnection(): Promise<{ ok: boolean; at: string; message: string }> {
  return withToken("/api/ai/test", { method: "POST", body: "{}" });
}

export async function runAiTask(request: AiTaskRequest, signal?: AbortSignal): Promise<AiTaskResponse> {
  return withToken(`/api/ai/${request.taskType}`, { method: "POST", body: JSON.stringify(request), ...(signal ? { signal } : {}) });
}
